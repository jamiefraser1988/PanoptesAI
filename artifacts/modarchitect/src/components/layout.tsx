import { ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";
import { Activity, Settings, LogOut, Shield, Menu } from "lucide-react";
import { useHealthCheck, getHealthCheckQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useUser, useClerk } from "@clerk/react";
import { useIsMobile } from "@/hooks/use-mobile";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function UserSection() {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();

  if (!isLoaded || !user) return null;

  return (
    <div className="px-4 py-3 border-t border-border">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary shrink-0">
          {user.firstName?.[0] || user.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() || "U"}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">
            {user.firstName || user.emailAddresses?.[0]?.emailAddress || "User"}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={() => signOut({ redirectUrl: "/" })}
        >
          <LogOut className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

const clerkEnabled = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

const navItems = [
  { href: "/dashboard", label: "Flagged Queue", icon: Shield },
  { href: "/analytics", label: "Stats & Analytics", icon: Activity },
  { href: "/config", label: "Configuration", icon: Settings },
];

function SidebarContent({ location, onNavClick }: { location: string; onNavClick?: () => void }) {
  const { data: health } = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey() } });

  return (
    <>
      <div className="h-16 flex items-center px-6 border-b border-border gap-2">
        <img src={`${basePath}/logo.png`} alt="PanoptesAI" className="w-7 h-7 object-contain" />
        <h1 className="font-bold text-lg tracking-tight text-foreground">
          <span className="text-primary">Panoptes</span>AI
        </h1>
      </div>
      <nav className="flex-1 py-4 flex flex-col gap-1 px-3">
        {navItems.map((item) => {
          const isActive = location === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavClick}
              className={`flex items-center px-3 py-3 md:py-2 rounded-md text-sm font-medium transition-colors min-h-[44px] ${
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground border-l-2 border-primary"
                  : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground border-l-2 border-transparent"
              }`}
              data-testid={`nav-${item.label.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
            >
              <Icon className="w-4 h-4 mr-3" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {clerkEnabled && <UserSection />}

      <div className="p-4 border-t border-border">
        <div className="flex items-center text-xs text-muted-foreground">
          <div className={`w-2 h-2 rounded-full mr-2 ${health?.status === 'ok' ? 'bg-green-500' : 'bg-red-500'}`} />
          System Status: {health?.status === 'ok' ? 'Operational' : 'Degraded'}
        </div>
      </div>
    </>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const isMobile = useIsMobile();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      {isMobile ? (
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-72 p-0 bg-sidebar border-r border-border">
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation</SheetTitle>
              <SheetDescription>Main navigation menu</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col h-full">
              <SidebarContent location={location} onNavClick={() => setMobileOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>
      ) : (
        <aside className="w-64 border-r border-border bg-sidebar flex flex-col shrink-0">
          <SidebarContent location={location} />
        </aside>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 md:h-16 flex items-center justify-between px-4 md:px-6 border-b border-border bg-card/50 shrink-0">
          <div className="flex items-center gap-3">
            {isMobile && (
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 shrink-0"
                onClick={() => setMobileOpen(true)}
                data-testid="btn-mobile-menu"
              >
                <Menu className="w-5 h-5" />
              </Button>
            )}
            <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase truncate">
              {navItems.find(i => i.href === location)?.label || "Dashboard"}
            </h2>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent text-xs font-medium text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
              <span className="hidden sm:inline">Live Monitoring</span>
              <span className="sm:hidden">Live</span>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-3 md:p-6">
          <div className="max-w-6xl mx-auto h-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
