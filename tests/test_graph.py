from pathlib import Path

from network_map import Person, build_graph, load_excel, load_linkedin_export, merge_people, normalize_org

EXAMPLES = Path(__file__).resolve().parent.parent / "examples"


def ids(graph, kind):
    return {n["id"] for n in graph.nodes if n["kind"] == kind}


def edge_set(graph):
    return {(e["from"], e["to"], e["kind"]) for e in graph.edges}


def test_normalize_org_handles_suffixes_and_aliases():
    assert normalize_org("Delta Air Lines, Inc.") == "delta air lines"
    assert normalize_org("BYU") == normalize_org("Brigham Young University")
    assert normalize_org("Ernst & Young") == normalize_org("EY")


def test_three_people_form_a_group_two_do_not():
    people = [Person("A", company="Acme"), Person("B", company="Acme"), Person("C", company="ACME Inc."),
              Person("D", company="Solo Co"), Person("E", company="Solo Co")]
    g = build_graph(people, me="Me")
    assert ids(g, "company") == {"company:acme"}
    assert ("company:acme", "p:a", "member") in edge_set(g)
    assert ("me", "p:d", "direct") in edge_set(g)  # only 2 at Solo Co


def test_min_group_size_is_configurable():
    people = [Person("A", company="Acme"), Person("B", company="Acme")]
    assert ids(build_graph(people, min_group_size=2), "company") == {"company:acme"}


def test_person_in_two_groups_gets_one_solid_and_one_dashed_link():
    people = [Person(n, company="Acme", school="State U") for n in "ABC"]
    kinds = {e["kind"] for e in build_graph(people).edges if e["to"] == "p:a"}
    assert kinds == {"member", "also"}


def test_second_degree_hangs_off_connector_and_placeholder_is_added():
    people = [Person("Jordan"), Person("Rachel", connected_through="Jordan"),
              Person("Zed", connected_through="Unknown Person")]
    g = build_graph(people)
    assert ("p:jordan", "p:rachel", "intro") in edge_set(g)
    assert "p:unknown person" in ids(g, "person")  # placeholder connector
    assert {"p:rachel", "p:zed"} == ids(g, "second")


def test_me_is_not_duplicated_and_self_reference_counts_as_direct():
    people = [Person("Me"), Person("A", connected_through="me")]
    g = build_graph(people, me="Me")
    assert [n["id"] for n in g.nodes].count("me") == 1
    assert "p:a" in ids(g, "person")


def test_linkedin_export_skips_notes_header():
    people = load_linkedin_export(EXAMPLES / "sample_linkedin_connections.csv")
    assert people[0].name == "Jordan Lee"
    assert people[0].company == "Northwind Consulting"


def test_excel_overrides_linkedin_on_merge():
    merged = merge_people(
        [Person("Jordan Lee", company="Old Co", linkedin_url="https://x", source="linkedin")],
        [Person("Jordan Lee", company="New Co", school="State U", source="excel")],
    )
    assert len(merged) == 1
    p = merged[0]
    assert (p.company, p.school, p.linkedin_url, p.source) == ("New Co", "State U", "https://x", "linkedin+excel")


def test_demo_data_builds():
    people = merge_people(load_linkedin_export(EXAMPLES / "sample_linkedin_connections.csv"),
                          load_excel(EXAMPLES / "sample_contacts.xlsx"))
    g = build_graph(people, me="Alex Rivera")
    stats = g.stats()
    assert stats["people"] == 26 and stats["groups"] == 5
