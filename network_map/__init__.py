"""Network Map: turn your contacts into an interactive map of who you know."""

from .graph import build_graph, normalize_org
from .loader import Person, load_excel, load_linkedin_export, merge_people
from .render import render_html

__all__ = ["Person", "build_graph", "normalize_org", "load_excel",
           "load_linkedin_export", "merge_people", "render_html"]
__version__ = "0.1.0"
