"use client";

import {
  Braces,
  CheckCircle2,
  Code2,
  FileText,
  GitPullRequest,
  ListTodo,
  PanelLeft,
  Settings2,
  TerminalSquare,
  type LucideIcon
} from "lucide-react";
import { useId, useState } from "react";

type TabId = "project" | "task-plan" | "code-implementation" | "pr" | "settings";

interface NavigationTab {
  id: TabId;
  label: string;
  icon: LucideIcon;
}

const navigationTabs: readonly NavigationTab[] = [
  { id: "project", label: "Project", icon: FileText },
  { id: "task-plan", label: "Task plan", icon: ListTodo },
  { id: "code-implementation", label: "Code implementation", icon: Code2 },
  { id: "pr", label: "PR", icon: GitPullRequest },
  { id: "settings", label: "Settings", icon: Settings2 }
];

const tabHeadings: Record<TabId, { eyebrow: string; title: string; description: string }> = {
  project: {
    eyebrow: "Workspace",
    title: "Project",
    description: "Project environment and runtime assumptions."
  },
  "task-plan": {
    eyebrow: "Delivery",
    title: "Task plan",
    description: "The current execution plan for this workspace."
  },
  "code-implementation": {
    eyebrow: "Workspace",
    title: "Code implementation",
    description: "Implementation boundaries and current source layout."
  },
  pr: {
    eyebrow: "Delivery",
    title: "Pull request",
    description: "Review state for the current workspace."
  },
  settings: {
    eyebrow: "Workspace",
    title: "Settings",
    description: "Local runner and session defaults."
  }
};

export function WorkspaceShell() {
  const [activeTab, setActiveTab] = useState<TabId>("project");
  const tabPanelId = useId();
  const heading = tabHeadings[activeTab];

  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar" aria-label="Workspace navigation">
        <div className="workspace-brand">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <strong>Supply Flow</strong>
            <span>Session workspace</span>
          </div>
        </div>

        <nav className="workspace-nav" role="tablist" aria-orientation="vertical">
          {navigationTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.id === activeTab;

            return (
              <button
                aria-controls={tabPanelId}
                aria-selected={isActive}
                className={`workspace-nav-tab${isActive ? " is-active" : ""}`}
                id={`tab-${tab.id}`}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                role="tab"
                type="button"
              >
                <Icon aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="workspace-sidebar-footer">
          <span className="footer-status" aria-hidden="true">
            <CheckCircle2 />
          </span>
          <div>
            <strong>Local runner</strong>
            <span>tmux available</span>
          </div>
        </div>
      </aside>

      <main className="workspace-main">
        <header className="workspace-topbar">
          <div className="workspace-location">
            <PanelLeft aria-hidden="true" />
            <span>Supply Flow</span>
            <span className="location-divider">/</span>
            <strong>{heading.title}</strong>
          </div>
          <span className="local-status">
            <span />
            Local
          </span>
        </header>

        <section
          aria-labelledby={`tab-${activeTab}`}
          className="workspace-panel"
          id={tabPanelId}
          role="tabpanel"
        >
          <div className="panel-heading">
            <p>{heading.eyebrow}</p>
            <h1>{heading.title}</h1>
            <span>{heading.description}</span>
          </div>
          <PanelContent tab={activeTab} />
        </section>
      </main>
    </div>
  );
}

function PanelContent({ tab }: { tab: TabId }) {
  switch (tab) {
    case "project":
      return (
        <dl className="detail-list">
          <div>
            <dt>Session runtime</dt>
            <dd>tmux-backed terminal sessions</dd>
          </div>
          <div>
            <dt>Provider boundary</dt>
            <dd>Codex, Claude Code, and Gemini CLI adapters</dd>
          </div>
          <div>
            <dt>Workspace isolation</dt>
            <dd>One Git worktree per AI session</dd>
          </div>
          <div>
            <dt>Local persistence</dt>
            <dd>JSON metadata and NDJSON event history</dd>
          </div>
        </dl>
      );
    case "task-plan":
      return (
        <ol className="task-list">
          <li className="is-complete">
            <CheckCircle2 aria-hidden="true" />
            <div>
              <strong>Workspace foundation</strong>
              <span>Next.js web app, session runner, and shared contracts</span>
            </div>
          </li>
          <li>
            <span className="task-marker">2</span>
            <div>
              <strong>Session workspace</strong>
              <span>Terminal streaming, provider status, and session lifecycle</span>
            </div>
          </li>
          <li>
            <span className="task-marker">3</span>
            <div>
              <strong>Flow authoring</strong>
              <span>Integration context, tasks, and provider-assisted planning</span>
            </div>
          </li>
          <li>
            <span className="task-marker">4</span>
            <div>
              <strong>Review workflow</strong>
              <span>Change review and pull request coordination</span>
            </div>
          </li>
        </ol>
      );
    case "code-implementation":
      return (
        <div className="implementation-list">
          <div>
            <TerminalSquare aria-hidden="true" />
            <div>
              <strong>apps/runner</strong>
              <span>tmux session lifecycle and local command entrypoint</span>
            </div>
          </div>
          <div>
            <Braces aria-hidden="true" />
            <div>
              <strong>packages/core</strong>
              <span>File store, provider adapters, session contracts, and tmux adapter</span>
            </div>
          </div>
          <div>
            <Code2 aria-hidden="true" />
            <div>
              <strong>apps/web</strong>
              <span>Operator workspace and browser-facing session controls</span>
            </div>
          </div>
        </div>
      );
    case "pr":
      return (
        <div className="empty-state">
          <GitPullRequest aria-hidden="true" />
          <div>
            <strong>No pull request</strong>
            <span>The workspace is on the initial commit.</span>
          </div>
        </div>
      );
    case "settings":
      return (
        <dl className="detail-list">
          <div>
            <dt>Runner host</dt>
            <dd>Local development environment</dd>
          </div>
          <div>
            <dt>State directory</dt>
            <dd>
              <code>.supply-flow</code>
            </dd>
          </div>
          <div>
            <dt>Database</dt>
            <dd>Not configured</dd>
          </div>
          <div>
            <dt>Session transport</dt>
            <dd>tmux terminal adapter</dd>
          </div>
        </dl>
      );
  }
}
