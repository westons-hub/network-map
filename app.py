"""Streamlit version of Network Map: upload your files, see your map.

Run: pip install -r requirements-app.txt && streamlit run app.py

Uploaded files stay in this Streamlit session's memory. Nothing is saved or sent
anywhere else, but only run it on your own machine if your contacts are private.
"""

from __future__ import annotations

from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

from network_map import (build_graph, intro_report, load_excel, load_linkedin_export, load_targets,
                         merge_people, parse_target_list, render_page)

HERE = Path(__file__).parent
EXAMPLES = HERE / "examples"

st.set_page_config(page_title="Network Map", page_icon="🕸️", layout="wide")
st.title("Network Map")

with st.sidebar:
    st.header("Your data")
    demo = st.toggle("Use fictional demo data", value=False)
    contacts_file = st.file_uploader("Contacts (.xlsx from the template, or .csv)", type=["xlsx", "csv"],
                                     disabled=demo)
    linkedin_file = st.file_uploader("LinkedIn Connections.csv (optional)", type=["csv"], disabled=demo)
    me = st.text_input("Your name", value="Alex Rivera" if demo else "Weston Jackson")
    st.header("Options")
    extra_targets = st.text_area("Target companies (comma or one per line)",
                                 help="Added to the Targets sheet in your workbook, if it has one.")
    min_group = st.slider("People needed to form a group", 2, 10, 3)
    group_by = st.multiselect("Group by", ["company", "school", "tags"], default=["company", "school"])
    st.download_button("Blank contacts template", (HERE / "template" / "contacts_template.xlsx").read_bytes(),
                       file_name="contacts_template.xlsx")

if demo:
    contacts_src, linkedin_src = EXAMPLES / "sample_contacts.xlsx", EXAMPLES / "sample_linkedin_connections.csv"
else:
    contacts_src, linkedin_src = contacts_file, linkedin_file

if not contacts_src and not linkedin_src:
    st.info("Upload your contacts file (or turn on the demo data) in the sidebar to build your map.")
    st.stop()

try:
    sources = []
    if linkedin_src:  # LinkedIn first, so your Excel edits win
        sources.append(load_linkedin_export(linkedin_src))
    if contacts_src:
        sources.append(load_excel(contacts_src))
    people = merge_people(*sources)
    targets = (load_targets(contacts_src) if contacts_src else []) + parse_target_list(extra_targets)
except ValueError as e:
    st.error(str(e))
    st.stop()

graph = build_graph(people, me=me, min_group_size=min_group, group_by=tuple(group_by), targets=targets)
title = f"{me.split()[0]}'s Network" if me.strip() else "My Network"
html = render_page(graph, title=title, min_group_size=min_group)

s = graph.stats()
cols = st.columns(5)
cols[0].metric("People", s["people"])
cols[1].metric("Direct", s["direct"])
cols[2].metric("2nd-degree", s["second_degree"])
cols[3].metric("Groups", s["groups"])
cols[4].metric("Targets covered", f"{s['targets'] - s['gaps']}/{s['targets']}" if s["targets"] else "—")

map_tab, intro_tab, targets_tab = st.tabs(["Map", "Who can intro me?", "Targets"])

with map_tab:
    components.html(html, height=760, scrolling=False)
    st.download_button("Download map (HTML, works offline)", html, file_name="network_map.html",
                       mime="text/html")

with intro_tab:
    query = st.text_input("Company or person", placeholder="e.g. Northwind Consulting")
    if query:
        st.markdown(intro_report(people, [query], me=me))
    elif targets:
        report = intro_report(people, [t["label"] for t in graph.targets], me=me)
        st.markdown(report)
        st.download_button("Download report (.md)", report, file_name="intro_report.md")
    else:
        st.caption("Type a company or person, or add target companies in the sidebar.")

with targets_tab:
    if not graph.targets:
        st.caption("No targets yet. Add a Targets sheet to your workbook or list companies in the sidebar.")
    else:
        st.dataframe(
            [{"Target": t["label"], "Direct": len(t["direct"]), "2nd-degree+": len(t["second"]),
              "People": ", ".join(t["direct"] + t["second"]) or "No one yet"} for t in graph.targets],
            hide_index=True, use_container_width=True,
        )
