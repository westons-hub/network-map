"""Turn a list of people into nodes and edges for the network map.

Rules:
* You are the center node.
* Anyone with a blank "Connected Through" is a direct (1st-degree) connection.
* Anyone whose "Connected Through" names another person hangs off that person
  (2nd-degree). If the connector isn't in your list yet, a placeholder is added.
* When MIN_GROUP_SIZE or more direct connections share a company or school,
  they collapse into a group bubble: you -> group -> each member.
  Someone who belongs to two groups gets a solid line to one and a dashed line
  to the other.
* Target companies: groups and people at a target are flagged. A target with
  nobody on the map becomes a hollow "gap" node linked to you, so it's easy to
  see where you still need a first contact.
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field

from .loader import Person, normalize_name

MIN_GROUP_SIZE = 3

# Spellings that should count as the same organization. Keys and values are
# normalized (lowercase, no punctuation or legal suffixes). Add your own.
ALIASES = {
    "byu": "brigham young university",
    "byu marriott": "brigham young university",
    "byu marriott school of business": "brigham young university",
    "marriott school of business": "brigham young university",
    "u of u": "university of utah",
    "uofu": "university of utah",
    "the church of jesus christ of latterday saints": "church of jesus christ",
    "lds church": "church of jesus christ",
    "mojang": "mojang studios",
    "mojang ab": "mojang studios",
    "google llc": "google",
    "alphabet": "google",
    "meta platforms": "meta",
    "facebook": "meta",
    "ey": "ernst young",
    "ernst and young": "ernst young",
}

_SUFFIXES = {"inc", "llc", "ltd", "co", "corp", "corporation", "company", "plc", "the", "lp", "llp"}


def normalize_org(name: str) -> str:
    """'Delta Air Lines, Inc.' -> 'delta air lines'; 'BYU' -> 'brigham young university'."""
    text = re.sub(r"[^\w\s]", "", str(name).casefold().replace("&", " "))
    words = [w for w in text.split() if w not in _SUFFIXES]
    key = " ".join(words)
    return ALIASES.get(key, key)


@dataclass
class Graph:
    nodes: list[dict] = field(default_factory=list)
    edges: list[dict] = field(default_factory=list)
    groups: dict[str, list[str]] = field(default_factory=dict)  # group node id -> member names
    # One entry per target company: label, node to focus, and who you know there.
    targets: list[dict] = field(default_factory=list)

    def stats(self) -> dict:
        kinds = Counter(n["kind"] for n in self.nodes)
        return {
            "people": kinds["person"] + kinds["second"],
            "direct": kinds["person"],
            "second_degree": kinds["second"],
            "groups": kinds["company"] + kinds["school"] + kinds["tag"],
            "targets": len(self.targets),
            "gaps": kinds["gap"],
        }


def _display_names(people: list[Person], attr: str) -> dict[str, str]:
    """Pick the most common original spelling as the label for each normalized org."""
    spellings: dict[str, Counter] = defaultdict(Counter)
    for p in people:
        value = getattr(p, attr)
        if value:
            spellings[normalize_org(value)][value] += 1
    return {k: c.most_common(1)[0][0] for k, c in spellings.items()}


def build_graph(
    people: list[Person],
    me: str = "Me",
    min_group_size: int = MIN_GROUP_SIZE,
    group_by: tuple[str, ...] = ("company", "school"),
    targets: list[str] | tuple[str, ...] = (),
) -> Graph:
    g = Graph()
    me_key = normalize_name(me)
    by_key = {p.key: p for p in people if p.key != me_key}

    # Add placeholders for connectors that were named but never listed.
    for p in list(by_key.values()):
        ck = normalize_name(p.connected_through) if p.connected_through else ""
        if ck and ck != me_key and ck not in by_key:
            by_key[ck] = Person(name=p.connected_through, notes="Added automatically as a connector.",
                                source="placeholder")

    def is_direct(p: Person) -> bool:
        ck = normalize_name(p.connected_through) if p.connected_through else ""
        return not ck or ck == me_key

    direct = [p for p in by_key.values() if is_direct(p)]
    second = [p for p in by_key.values() if not is_direct(p)]

    g.nodes.append({"id": "me", "label": me, "kind": "me"})

    # ---- find groups among direct connections ----------------------------
    labels = {"company": _display_names(direct, "company"),
              "school": _display_names(direct, "school")}
    counts: dict[tuple[str, str], list[Person]] = defaultdict(list)
    for p in direct:
        if "company" in group_by and p.company:
            counts[("company", normalize_org(p.company))].append(p)
        if "school" in group_by and p.school:
            counts[("school", normalize_org(p.school))].append(p)
        if "tags" in group_by:
            for t in p.tags:
                counts[("tag", t.casefold())].append(p)

    group_ids: dict[tuple[str, str], str] = {}
    for (kind, key), members in sorted(counts.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        if len(members) < min_group_size:
            continue
        gid = f"{kind}:{key}"
        label = labels.get(kind, {}).get(key) or next(t for t in members[0].tags if t.casefold() == key)
        group_ids[(kind, key)] = gid
        g.groups[gid] = [m.name for m in members]
        g.nodes.append({"id": gid, "label": label, "kind": kind, "count": len(members)})
        g.edges.append({"from": "me", "to": gid, "kind": "group"})

    def memberships(p: Person) -> list[str]:
        out = []
        for kind, attr in (("company", p.company), ("school", p.school)):
            gid = group_ids.get((kind, normalize_org(attr))) if attr else None
            if gid:
                out.append(gid)
        for t in p.tags:
            gid = group_ids.get(("tag", t.casefold()))
            if gid:
                out.append(gid)
        return out

    def person_node(p: Person, kind: str) -> dict:
        return {
            "id": f"p:{p.key}",
            "label": p.name,
            "kind": kind,
            "company": p.company,
            "school": p.school,
            "role": p.role,
            "status": p.status,
            "tags": p.tags,
            "notes": p.notes,
            "url": p.linkedin_url,
            "via": p.connected_through,
            "source": p.source,
        }

    # ---- direct connections ------------------------------------------------
    for p in sorted(direct, key=lambda x: x.name):
        g.nodes.append(person_node(p, "person"))
        groups = memberships(p)
        if groups:
            g.edges.append({"from": groups[0], "to": f"p:{p.key}", "kind": "member"})
            for extra in groups[1:]:
                g.edges.append({"from": extra, "to": f"p:{p.key}", "kind": "also"})
        else:
            g.edges.append({"from": "me", "to": f"p:{p.key}", "kind": "direct"})

    # ---- 2nd-degree connections -------------------------------------------
    for p in sorted(second, key=lambda x: x.name):
        g.nodes.append(person_node(p, "second"))
        g.edges.append({"from": f"p:{normalize_name(p.connected_through)}",
                        "to": f"p:{p.key}", "kind": "intro"})
        for gid in memberships(p):  # show overlap with your existing groups
            g.edges.append({"from": gid, "to": f"p:{p.key}", "kind": "also"})

    # ---- target companies ---------------------------------------------------
    nodes_by_id = {n["id"]: n for n in g.nodes}
    seen: set[str] = set()
    for label in targets:
        key = normalize_org(label)
        if not key or key in seen:
            continue
        seen.add(key)
        at = [p for p in by_key.values() if p.company and normalize_org(p.company) == key]
        direct_at = sorted(p.name for p in at if is_direct(p))
        second_at = sorted(p.name for p in at if not is_direct(p))
        for p in at:
            nodes_by_id[f"p:{p.key}"]["target"] = True
        gid = group_ids.get(("company", key))
        if gid:
            nodes_by_id[gid]["target"] = True
            focus = gid
        elif at:
            focus = f"p:{sorted(at, key=lambda p: (not is_direct(p), p.name))[0].key}"
        else:
            focus = f"target:{key}"
            g.nodes.append({"id": focus, "label": label, "kind": "gap", "target": True})
            g.edges.append({"from": "me", "to": focus, "kind": "gap"})
        g.targets.append({"label": label, "focus": focus, "direct": direct_at, "second": second_at})

    return g
