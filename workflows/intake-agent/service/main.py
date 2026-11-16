"""Intake service: checks the intake the LLM extracted from a lead's message and call notes, and turns it
into the client's architecture and access document (Markdown).

n8n gets the JSON schema from GET /schema for the LLM's structured output, so the model and this
service always agree on the shape. Request bodies are never logged: they hold client details (GDPR).
"""

import os
import secrets

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

TOKEN = os.environ["INTAKE_API_TOKEN"].encode()


class System(BaseModel):
    name: str = Field(description="Tool or system the client uses or needs, e.g. Excel sheet, current POS, WhatsApp Business, website")
    purpose: str = Field(description="What the client uses it for, one sentence")
    access_needed: list[str] = Field(description="What to ask the client for, as role plus account, e.g. 'Admin login to the current POS', 'Export of the Excel stock sheet'")
    owner: str | None = Field(None, description="Who at the client controls it, if said in the call")


class Integration(BaseModel):
    source: str = Field(description="System the data comes from, same name as in systems")
    target: str = Field(description="System the data goes to, same name as in systems")
    method: str = Field(description="How: API, webhook, CSV export, n8n, manual entry")


class Intake(BaseModel):
    client: str = Field(description="Company name")
    summary: str = Field(max_length=600, description="2 or 3 sentences: how they work today, what they want, the main constraint")
    goals: list[str] = Field(min_length=1)
    systems: list[System] = Field(min_length=1)
    integrations: list[Integration] = []
    risks: list[str] = Field([], description="Things that could block or delay the build")
    open_questions: list[str] = Field([], description="What the call did not answer")


app = FastAPI(title="Intake service", docs_url=None, redoc_url=None, openapi_url=None)


def require_token(authorization: str = Header("")) -> None:
    if not secrets.compare_digest(authorization.encode(), b"Bearer " + TOKEN):
        raise HTTPException(401, "missing or wrong token")


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/schema")
def schema() -> dict:
    return inline_refs(Intake.model_json_schema())


def inline_refs(schema: dict) -> dict:
    """The schema with every $ref replaced by its definition: some models' JSON modes don't follow $ref."""
    defs = schema.pop("$defs", {})

    def walk(node):
        if isinstance(node, dict):
            if "$ref" in node:
                return walk(defs[node["$ref"].split("/")[-1]])
            return {k: walk(v) for k, v in node.items()}
        if isinstance(node, list):
            return [walk(v) for v in node]
        return node

    return walk(schema)


@app.post("/render", response_class=PlainTextResponse, dependencies=[Depends(require_token)])
def render_endpoint(intake: Intake) -> str:
    return render(intake)


def cell(text: str) -> str:
    """LLM text inside a Markdown table: a pipe or a line break would split the row."""
    return text.replace("|", "\\|").replace("\n", " ")


def render(i: Intake) -> str:
    out = [f"# {i.client}: architecture and access", "", i.summary, "", "## Goals", ""]
    out += [f"- {g}" for g in i.goals]

    out += ["", "## Systems and access", "", "| System | Purpose | Access needed | Owner |", "|---|---|---|---|"]
    out += [
        f"| {cell(s.name)} | {cell(s.purpose)} | {cell(', '.join(s.access_needed))} | {cell(s.owner or 'Unknown')} |"
        for s in i.systems
    ]

    if i.integrations:
        # Mermaid ids must be plain, so each system gets n0, n1, ... and its name goes in the label.
        ids: dict[str, str] = {}
        node = lambda name: ids.setdefault(name, f"n{len(ids)}")
        quote = lambda text: '"' + text.replace('"', "'") + '"'  # a double quote would end the label
        edges = [f"    {node(x.source)} -- {quote(x.method)} --> {node(x.target)}" for x in i.integrations]
        labels = [f"    {nid}[{quote(name)}]" for name, nid in ids.items()]
        out += ["", "## How data flows", "", "```mermaid", "flowchart LR", *labels, *edges, "```"]

    for title, items in (("Risks", i.risks), ("Open questions", i.open_questions)):
        if items:
            out += ["", f"## {title}", ""] + [f"- {x}" for x in items]

    return "\n".join(out) + "\n"
