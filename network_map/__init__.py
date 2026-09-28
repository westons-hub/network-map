"""Network Map: turn your contacts into an interactive map of who you know."""

from .graph import build_graph, normalize_org
from .loader import (Person, load_excel, load_linkedin_export, load_targets, merge_people,
                     parse_target_list)
from .render import render_html, render_page
from .report import intro_report, who_can_intro

__all__ = ["Person", "build_graph", "normalize_org", "load_excel", "load_linkedin_export",
           "load_targets", "parse_target_list", "merge_people", "render_html", "render_page",
           "intro_report", "who_can_intro"]
__version__ = "0.1.0"
