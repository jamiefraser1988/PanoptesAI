import { useEffect, useLayoutEffect, useRef, Component, Suspense, lazy, type ReactNode } from "react";
import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk } from "@clerk/react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";
import NotFound from "@/pages/not-found";
import { apiBaseUrl, appOrigin, basePath, clerkPubKey, clerkSignInUrl, clerkSignUpUrl } from "@/lib/runtime";
import Layout from "@/components/layout";

const Queue = lazy(() => import("@/pages/queue"));
const Home = lazy(() => import("@/pages/home"));
const Analytics = lazy(() => import("@/pages/analytics"));
const Config = lazy(() => import("@/pages/config"));
const ModLog = lazy(() => import("@/pages/mod-log"));
const Terms = lazy(() => import("@/pages/terms"));
const Privacy = lazy(() => import("@/pages/privacy"));

if (apiBaseUrl) setBaseUrl(apiBaseUrl);

const queryClient = new QueryClient();
class ClerkErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

function getClerkResetUrl(returnPath: string): string {
  return `${basePath || ""}/clerk-cookie-reset.html?return=${encodeURIComponent(`${basePath || ""}${returnPath}`)}`;
}

function AuthRecoveryHint({ returnPath }: { returnPath: "/sign-in" | "/sign-up" }) {
  return (
    <div className="mt-4 text-center text-xs text-muted-foreground">
      Having trouble with authentication?{" "}
      <a className="text-primary hover:underline" href={getClerkResetUrl(returnPath)}>
        Reset sign-in state
      </a>
      .
    </div>
  );
}

type HostedAuthMode = "sign-in" | "sign-up";

function getCanonicalAppOrigin(): string {
  if (typeof window !== "undefined") {
    const canonicalUrl = new URL(window.location.href);
    if (canonicalUrl.hostname === "panoptesai.net") {
      canonicalUrl.hostname = "www.panoptesai.net";
    }
    return canonicalUrl.origin;
  }

  return appOrigin || "https://www.panoptesai.net";
}

function sanitizeClerkRedirectTarget(target: string | null | undefined): string {
  const origin = `${getCanonicalAppOrigin()}/`;
  const fallback = new URL(`${basePath || ""}/dashboard`, origin);

  if (!target) {
    return fallback.toString();
  }

  try {
    const candidate = new URL(target, origin);
    if (candidate.origin !== fallback.origin) {
      return fallback.toString();
    }
    return candidate.toString();
  } catch {
    return fallback.toString();
  }
}

function buildHostedClerkUrl(baseUrl: string, search: string): string {
  const params = new URLSearchParams(search);
  const requestedRedirect =
    params.get("redirect_url") ??
    params.get("sign_in_force_redirect_url") ??
    params.get("sign_up_force_redirect_url");
  const redirectUrl = sanitizeClerkRedirectTarget(requestedRedirect);
  const destination = new URL(baseUrl);

  destination.searchParams.set("redirect_url", redirectUrl);
  destination.searchParams.set("sign_in_force_redirect_url", redirectUrl);
  destination.searchParams.set("sign_up_force_redirect_url", redirectUrl);

  return destination.toString();
}

function HostedAuthRedirectPage({ destination, mode }: { destination: string; mode: HostedAuthMode }) {
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.location.replace(destination);
  }, [destination]);

  const actionLabel = mode === "sign-in" ? "sign in" : "sign up";
  const returnPath = mode === "sign-in" ? "/sign-in" : "/sign-up";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold text-foreground">Redirecting to secure {actionLabel}</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          PanoptesAI now uses Clerk&apos;s hosted authentication pages for account access.
        </p>
      </div>
      <a className="text-sm text-primary hover:underline" href={destination}>
        Continue to {actionLabel}
      </a>
      <AuthRecoveryHint returnPath={returnPath} />
    </div>
  );
}

function SignInPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const hostedSignInDestination =
    clerkSignInUrl && buildHostedClerkUrl(clerkSignInUrl, typeof window === "undefined" ? "" : window.location.search);

  if (isLoaded && isSignedIn) {
    return <Redirect to="/dashboard" />;
  }

  if (hostedSignInDestination) {
    return <HostedAuthRedirectPage destination={hostedSignInDestination} mode="sign-in" />;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        forceRedirectUrl={`${basePath}/dashboard`}
        fallbackRedirectUrl={`${basePath}/dashboard`}
      />
      <AuthRecoveryHint returnPath="/sign-in" />
    </div>
  );
}

function SignUpPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const hostedSignUpDestination =
    clerkSignUpUrl && buildHostedClerkUrl(clerkSignUpUrl, typeof window === "undefined" ? "" : window.location.search);

  if (isLoaded && isSignedIn) {
    return <Redirect to="/dashboard" />;
  }

  if (hostedSignUpDestination) {
    return <HostedAuthRedirectPage destination={hostedSignUpDestination} mode="sign-up" />;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
        forceRedirectUrl={`${basePath}/dashboard`}
        fallbackRedirectUrl={`${basePath}/dashboard`}
      />
      <AuthRecoveryHint returnPath="/sign-up" />
    </div>
  );
}

function AuthLoadingScreen() {
  return <div className="min-h-screen bg-background" />;
}

function RouteLoadingScreen({ inLayout = false }: { inLayout?: boolean }) {
  return <div className={inLayout ? "h-full min-h-[12rem] bg-background" : "min-h-screen bg-background"} />;
}

function DashboardRoutes({ includeRootQueue = false }: { includeRootQueue?: boolean }) {
  return (
    <Suspense fallback={<RouteLoadingScreen inLayout />}>
      <Switch>
        {includeRootQueue ? <Route path="/" component={Queue} /> : null}
        <Route path="/dashboard" component={Queue} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/mod-log" component={ModLog} />
        <Route path="/config" component={Config} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function AuthenticatedDashboard() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return <AuthLoadingScreen />;
  }

  if (!isSignedIn) {
    return <Redirect to="/" />;
  }

  return (
    <Layout>
      <DashboardRoutes />
    </Layout>
  );
}

function HomeRedirect() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return <AuthLoadingScreen />;
  }

  return <Home isSignedIn={isSignedIn} />;
}

function ClerkAuthTokenSetter() {
  const { getToken, isSignedIn } = useAuth();

  useLayoutEffect(() => {
    setAuthTokenGetter(async () => {
      try {
        return await getToken();
      } catch {
        return null;
      }
    });
  }, [getToken, isSignedIn]);

  return null;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function ClerkAuthRouteClientResetter() {
  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkAuthRouteClientResetter />
        <ClerkAuthTokenSetter />
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Suspense fallback={<RouteLoadingScreen />}>
            <Switch>
              <Route path="/" component={HomeRedirect} />
              <Route path="/terms" component={Terms} />
              <Route path="/privacy" component={Privacy} />
              <Route path="/sign-in/*?" component={SignInPage} />
              <Route path="/sign-up/*?" component={SignUpPage} />
              <Route path="/dashboard" component={AuthenticatedDashboard} />
              <Route path="/analytics" component={AuthenticatedDashboard} />
              <Route path="/mod-log" component={AuthenticatedDashboard} />
              <Route path="/config" component={AuthenticatedDashboard} />
              <Route component={NotFound} />
            </Switch>
          </Suspense>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
    setBaseUrl(apiBaseUrl || null);
  }, []);

  if (!clerkPubKey) {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Suspense fallback={<RouteLoadingScreen />}>
            <WouterRouter base={basePath}>
              <Switch>
                <Route path="/terms" component={Terms} />
                <Route path="/privacy" component={Privacy} />
                <Route>
                  <Layout>
                    <DashboardRoutes includeRootQueue />
                  </Layout>
                </Route>
              </Switch>
            </WouterRouter>
          </Suspense>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    );
  }

  const fallbackApp = (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Suspense fallback={<RouteLoadingScreen />}>
          <WouterRouter base={basePath}>
            <Switch>
              <Route path="/terms" component={Terms} />
              <Route path="/privacy" component={Privacy} />
              <Route>
                <Home />
              </Route>
            </Switch>
            <Toaster />
          </WouterRouter>
        </Suspense>
      </TooltipProvider>
    </QueryClientProvider>
  );

  return (
    <ClerkErrorBoundary fallback={fallbackApp}>
      <WouterRouter base={basePath}>
        <ClerkProviderWithRoutes />
      </WouterRouter>
    </ClerkErrorBoundary>
  );
}

export default App;
