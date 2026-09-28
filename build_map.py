"""Build your network map.

Examples:
    python build_map.py --me "Weston Jackson" --contacts my_contacts.xlsx
    python build_map.py --me "Weston Jackson" --contacts my_contacts.xlsx --linkedin Connections.csv
    python build_map.py --demo            # try it with the fictional sample data
"""

from __future__ import annotations

import argparse
import sys
import webbrowser
from pathlib import Path

from network_map import build_graph, load_excel, load_linkedin_export, merge_people, render_html

HERE = Path(__file__).parent


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Turn your contacts into an interactive network map.")
    ap.add_argument("--me", default="Me", help="Your name (the center of the map).")
    ap.add_argument("--contacts", help="Excel file made from template/contacts_template.xlsx.")
    ap.add_argument("--linkedin", help="Connections.csv from LinkedIn's 'Get a copy of your data'.")
    ap.add_argument("--out", default="network_map.html", help="Where to save the map (default: network_map.html).")
    ap.add_argument("--min-group", type=int, default=3, help="People needed to form a group (default: 3).")
    ap.add_argument("--group-by", default="company,school",
                    help="Comma list from: company, school, tags (default: company,school).")
    ap.add_argument("--title", default=None, help="Title shown at the top of the page.")
    ap.add_argument("--demo", action="store_true", help="Use the fictional sample data in examples/.")
    ap.add_argument("--no-open", action="store_true", help="Don't open the map in your browser.")
    args = ap.parse_args(argv)

    if args.demo:
        args.contacts = str(HERE / "examples" / "sample_contacts.xlsx")
        args.linkedin = str(HERE / "examples" / "sample_linkedin_connections.csv")
        args.me = "Alex Rivera" if args.me == "Me" else args.me

    if not args.contacts and not args.linkedin:
        ap.error("give --contacts and/or --linkedin (or try --demo)")

    sources = []
    if args.linkedin:  # LinkedIn first, so your Excel edits win
        sources.append(load_linkedin_export(args.linkedin))
    if args.contacts:
        sources.append(load_excel(args.contacts))
    people = merge_people(*sources)

    group_by = tuple(g.strip() for g in args.group_by.split(",") if g.strip())
    graph = build_graph(people, me=args.me, min_group_size=args.min_group, group_by=group_by)
    title = args.title or (f"{args.me.split()[0]}'s Network" if args.me != "Me" else "My Network")
    out = render_html(graph, args.out, title=title, min_group_size=args.min_group)

    s = graph.stats()
    print(f"Mapped {s['people']} people ({s['direct']} direct, {s['second_degree']} 2nd-degree) "
          f"into {s['groups']} groups -> {out.resolve()}")
    if not args.no_open:
        webbrowser.open(out.resolve().as_uri())
    return 0


if __name__ == "__main__":
    sys.exit(main())
