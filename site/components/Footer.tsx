import Logo from "./Logo";

export default function Footer() {
  return (
    <footer className="relative border-t border-ink/15 bg-ink px-5 py-16 text-paper">
      <div className="mx-auto grid max-w-5xl gap-10 md:grid-cols-3">
        <div className="win-shadow border border-paper/30 bg-bar p-4">
          <div className="flex items-center gap-2 font-display text-base font-bold">
            <Logo className="h-5 w-5" />
            jev-x-kit
          </div>
          <p className="mt-2 text-xs leading-relaxed text-paper/60">
            Version 0.1.0
            <br />
            MIT License. Public on GitHub.
            <br />
            Built for Claude Code. Made offline-first.
          </p>
        </div>
        <div className="text-xs text-paper/70">
          <div className="mb-2 font-bold text-paper">Kit</div>
          <ul className="space-y-1.5">
            <li>
              <a className="hover:text-lime-400" href="#coefficient">
                The Coefficient
              </a>
            </li>
            <li>
              <a className="hover:text-lime-400" href="#install">
                Install
              </a>
            </li>
            <li>
              <a className="hover:text-lime-400" href="#usage">
                CLI &amp; MCP tools
              </a>
            </li>
            <li>
              <a className="hover:text-lime-400" href="#benchmark">
                Benchmark methodology
              </a>
            </li>
          </ul>
        </div>
        <div className="text-xs text-paper/70">
          <div className="mb-2 font-bold text-paper">Elsewhere</div>
          <ul className="space-y-1.5">
            <li>
              <a
                className="hover:text-lime-400"
                href="https://github.com/Kadihx/jev-x-kit"
                target="_blank"
                rel="noreferrer"
              >
                GitHub repository ↗
              </a>
            </li>
            <li>
              <a
                className="hover:text-lime-400"
                href="https://typesafe.ai"
                target="_blank"
                rel="noreferrer"
              >
                TypeSafe Jev (upstream) ↗
              </a>
            </li>
            <li>
              <a
                className="hover:text-lime-400"
                href="https://modelcontextprotocol.io"
                target="_blank"
                rel="noreferrer"
              >
                Model Context Protocol ↗
              </a>
            </li>
          </ul>
        </div>
      </div>
      <p className="mx-auto mt-10 max-w-5xl text-[11px] text-paper/40">
        jev-x-kit is an independent, community-built kit. Not affiliated with
        or endorsed by TypeSafe AI.
      </p>
    </footer>
  );
}
