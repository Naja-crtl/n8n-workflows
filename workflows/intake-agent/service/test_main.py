# Run: pip install -r requirements-dev.txt && python test_main.py
import os

os.environ["INTAKE_API_TOKEN"] = "test-token"

from fastapi.testclient import TestClient  # noqa: E402

from main import app  # noqa: E402

c = TestClient(app)
auth = {"Authorization": "Bearer test-token"}
intake = {
    "client": "Acme Roofing",
    "summary": "Wants every Facebook lead in GHL within a minute and a text back.",
    "goals": ["Faster lead response"],
    "systems": [
        {"name": "GoHighLevel", "purpose": "CRM | pipeline", "access_needed": ["Sub-account admin"]},
        {"name": 'Facebook "Lead" Ads', "purpose": "Lead forms", "access_needed": ["Partner access"], "owner": "Mike"},
    ],
    "integrations": [{"source": 'Facebook "Lead" Ads', "target": "GoHighLevel", "method": "webhook"}],
    "open_questions": ["Who answers texts after hours?"],
}

assert c.get("/health").json() == {"ok": True}
sch = c.get("/schema").json()
assert "systems" in sch["properties"] and "$defs" not in sch and "$ref" not in str(sch), "schema inlined for JSON modes"
assert "access_needed" in sch["properties"]["systems"]["items"]["properties"]
assert c.post("/render", json=intake).status_code == 401, "no token"
assert c.post("/render", json=intake, headers={"Authorization": "Bearer wrong"}).status_code == 401
assert c.post("/render", json={**intake, "systems": []}, headers=auth).status_code == 422, "LLM output without systems"

doc = c.post("/render", json=intake, headers=auth).text
assert "| GoHighLevel | CRM \\| pipeline | Sub-account admin | Unknown |" in doc, "pipe escaped, owner defaulted"
assert "n0 -- \"webhook\" --> n1" in doc and "n0[\"Facebook 'Lead' Ads\"]" in doc, "mermaid ids and quotes"
assert "## Open questions" in doc and "## Risks" not in doc, "empty sections left out"

print("intake service: all checks passed")
