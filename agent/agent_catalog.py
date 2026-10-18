"""What the Agents page needs from this service: the default model, the
built-in prompts, and the tools each agent gets from here (the dashboard's
own tools are listed by the API)."""
from agent_settings import DEFAULT_MODEL

WEB_SEARCH = {"name": "tavily_search", "description": "Search the web.", "group": "Web"}
WEB_READ = {"name": "web_read", "description": "Open web pages (with “Safer web access” on, only pages it has seen in a search or your message).", "group": "Web"}


def catalog() -> dict:
    from coding import CODER_PROMPT, CODING_ENABLED
    from research import RESEARCHER_PROMPT
    import os
    return {
        "default_model": DEFAULT_MODEL,
        "agents": {
            "atlas": {
                "reasoning": None,
                "tools": [
                    {"name": "delegate_research", "description": "Send researchers out on the web, several at once.", "group": "Team"},
                    {"name": "ask_agent", "description": "Hand a task to one of your own agents.", "group": "Team"},
                    *([{"name": "delegate_coding", "description": "Have the coder change a repository and open a draft pull request.", "group": "Team"}] if CODING_ENABLED else []),
                    {"name": "ask_user", "description": "Stop and ask you something mid-task.", "group": "Team"},
                    WEB_SEARCH, WEB_READ,
                ],
            },
            "researcher": {
                "prompt": RESEARCHER_PROMPT,
                "reasoning": os.getenv("RESEARCH_REASONING_EFFORT", "high"),
                "note": "{objective} and {context} are filled in for each researcher.",
                "tools": [WEB_SEARCH, WEB_READ],
            },
            "coder": {
                "prompt": CODER_PROMPT,
                "reasoning": os.getenv("AGENT_REASONING_EFFORT", "max"),
                "note": ("{repo}, {branch}, {path}, {task}, {context}, {mode_note} and {scratch} are filled in for each task."
                         + ("" if CODING_ENABLED else " Coding is switched off on this server (ATLAS_AGENT_CODING).")),
                "tools": [
                    {"name": "sandbox_bash", "description": "Run shell commands in the sandbox.", "group": "Sandbox"},
                    {"name": "sandbox_file_editor", "description": "View and edit files in the checkout.", "group": "Sandbox"},
                    {"name": "commit_work", "description": "Commit and push to its branch.", "group": "Sandbox"},
                    {"name": "ask_user", "description": "Stop and ask you something mid-task.", "group": "Team"},
                ],
            },
        },
        "custom_tools": [WEB_SEARCH, WEB_READ],
    }
