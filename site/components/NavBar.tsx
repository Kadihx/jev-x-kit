import Logo from "./Logo";

const links = [
  { href: "#coefficient", label: "The Coefficient" },
  { href: "#install", label: "Install" },
  { href: "#usage", label: "Usage" },
  { href: "#benchmark", label: "Benchmark" },
];

export default function NavBar() {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-ink/15 bg-paper/90 px-5 py-3 backdrop-blur">
      <a href="#top" className="flex items-center gap-2 font-display text-lg font-bold">
        <Logo className="h-6 w-6 text-ink" />
        jev-x-kit
      </a>
      <nav className="hidden items-center gap-1 md:flex">
        {links.map((l) => (
          <a
            key={l.href}
            href={l.href}
            className="rounded-full border border-transparent px-3 py-1.5 text-xs font-medium hover:border-ink/20 hover:bg-white"
          >
            {l.label}
          </a>
        ))}
      </nav>
      <a
        href="https://github.com/Kadihx/jev-x-kit"
        target="_blank"
        rel="noreferrer"
        className="rounded-full bg-ink px-4 py-2 text-xs font-bold text-paper hover:bg-ink/80"
      >
        View on GitHub ↗
      </a>
    </header>
  );
}
