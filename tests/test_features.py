import io
from pathlib import Path

import pytest

from network_map import (Person, build_graph, intro_report, load_excel, load_linkedin_export, load_targets,
                         merge_people, parse_target_list, render_page, who_can_intro)

ROOT = Path(__file__).resolve().parent.parent
EXAMPLES = ROOT / "examples"


def demo_people():
    return merge_people(load_linkedin_export(EXAMPLES / "sample_linkedin_connections.csv"),
                        load_excel(EXAMPLES / "sample_contacts.xlsx"))


# ---- targets ----------------------------------------------------------------

def test_target_with_no_connections_becomes_gap_node():
    g = build_graph([Person("A", company="Acme")], targets=["Nowhere Inc."])
    gap = next(n for n in g.nodes if n["kind"] == "gap")
    assert gap["label"] == "Nowhere Inc." and gap["id"] == "target:nowhere"
    assert ("me", "target:nowhere", "gap") in {(e["from"], e["to"], e["kind"]) for e in g.edges}
    assert g.stats()["gaps"] == 1


def test_target_group_and_people_are_flagged_and_aliases_match():
    people = [Person(n, company="Ernst & Young") for n in "ABC"] + [Person("D", company="EY", connected_through="A")]
    g = build_graph(people, targets=["EY", "ey"])  # duplicate target ignored
    by_id = {n["id"]: n for n in g.nodes}
    assert by_id["company:ernst young"]["target"] is True
    assert by_id["p:d"]["target"] is True
    assert g.targets == [{"label": "EY", "focus": "company:ernst young", "direct": ["A", "B", "C"], "second": ["D"]}]
    assert g.stats()["gaps"] == 0


def test_target_without_group_focuses_a_person():
    g = build_graph([Person("Solo", company="Tiny Co")], targets=["Tiny Co"])
    assert g.targets[0]["focus"] == "p:solo"


def test_targets_sheet_and_list_parsing():
    assert load_targets(EXAMPLES / "sample_contacts.xlsx")[:2] == ["Northwind Consulting", "Summit Airlines"]
    assert load_targets(ROOT / "template" / "contacts_template.xlsx") == []
    assert load_targets(EXAMPLES / "sample_linkedin_connections.csv") == []
    assert parse_target_list("Delta, Bain;\nGoogle,,") == ["Delta", "Bain", "Google"]


def test_demo_targets():
    people = demo_people()
    g = build_graph(people, me="Alex Rivera", targets=load_targets(EXAMPLES / "sample_contacts.xlsx"))
    gaps = {t["label"] for t in g.targets if not (t["direct"] or t["second"])}
    assert gaps == {"Granite Peak Partners", "Harborview Media"}


# ---- intro report -------------------------------------------------------------

def test_who_can_intro_walks_the_chain_and_sorts_shortest_first():
    paths = who_can_intro(demo_people(), "Pinecrest Labs", me="Alex Rivera")
    assert [(p.person.name, p.chain) for p in paths] == [
        ("Zoe Adams", ["Liam Walsh", "Zoe Adams"]),
        ("Sam Rivera", ["Liam Walsh", "Zoe Adams", "Sam Rivera"]),
    ]
    assert paths[0].ask == "Liam Walsh"


def test_who_can_intro_matches_names_by_whole_word():
    people = [Person("Casey Stone"), Person("Pat Ey", company="Other")]
    assert [p.person.name for p in who_can_intro(people, "Casey")] == ["Casey Stone"]
    assert [p.person.name for p in who_can_intro(people, "ey")] == ["Pat Ey"]


def test_who_can_intro_survives_cycles():
    people = [Person("A", company="X", connected_through="B"), Person("B", connected_through="A")]
    assert who_can_intro(people, "X")[0].chain == ["B", "A"]


def test_intro_report_lists_gaps():
    text = intro_report(demo_people(), ["Summit Airlines", "Harborview Media"], me="Alex Rivera")
    assert "ask **Noah Carter** (your status with them: Met)" in text
    assert "Noah Carter, Commercial Strategy Analyst at Summit Airlines** [Met]: you know them directly." in text
    assert "Targets with no one on your map: Harborview Media" in text


# ---- loading from uploads (Streamlit) --------------------------------------------

def test_loaders_accept_file_objects():
    xlsx = io.BytesIO((EXAMPLES / "sample_contacts.xlsx").read_bytes()); xlsx.name = "upload.xlsx"
    csv = io.BytesIO((EXAMPLES / "sample_linkedin_connections.csv").read_bytes()); csv.name = "Connections.csv"
    assert len(load_excel(xlsx)) == 22
    assert len(load_targets(xlsx)) == 5  # re-reads the same buffer
    assert load_linkedin_export(csv)[0].name == "Jordan Lee"


def test_bad_upload_names_the_file():
    bad = io.BytesIO(b"hello\n"); bad.name = "oops.csv"
    with pytest.raises(ValueError, match="oops.csv"):
        load_linkedin_export(bad)


# ---- rendering -----------------------------------------------------------------

def test_page_includes_targets_and_status_toggle_and_escapes_script():
    people = [Person("</script><b>x", company="Acme", status="Met")]
    html = render_page(build_graph(people, targets=["Acme", "Gap Co"]))
    assert '"targets": [' in html and "Gap Co" in html
    assert 'id="status"' in html
    assert "</script><b>" not in html


def test_empty_contacts_file_builds_a_map_with_just_me():
    people = load_excel(ROOT / "template" / "contacts_template.xlsx")
    g = build_graph(people, me="Weston Jackson")
    assert people == [] and [n["kind"] for n in g.nodes] == ["me"]
    render_page(g)


def test_streamlit_app_runs_on_demo_data():
    pytest.importorskip("streamlit")
    from streamlit.testing.v1 import AppTest

    at = AppTest.from_file(str(ROOT / "app.py"), default_timeout=60).run()
    assert not at.exception
    assert at.info[0].value.startswith("Upload your contacts")
    at.toggle[0].set_value(True).run()
    assert not at.exception
    assert [m.value for m in at.metric][:4] == ["26", "18", "8", "5"]
    assert at.metric[4].value == "3/5"
