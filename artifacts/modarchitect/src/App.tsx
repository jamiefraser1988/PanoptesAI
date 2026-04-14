import { useEffect, useLayoutEffect, useRef, Component, type ReactNode } from "react";
import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk } from "@clerk/react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";
import NotFound from "@/pages/not-found";
import { apiBaseUrl, basePath, clerkPubKey } from "@/lib/runtime";

import Queue from "@/pages/queue";
import Analytics from "@/pages/analytics";
import Config from "@/pages/config";
import ModLog from "@/pages/mod-log";
import Home from "@/pages/home";
import Terms from "@/pages/terms";
import Privacy from "@/pages/privacy";
import Layout from "@/components/layout";

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

function SignInPage() {
  const { isLoaded, isSignedIn } = useAuth();

  if (isLoaded && isSignedIn) {
    return <Redirect to="/dashboard" />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        forceRedirectUrl={`${basePath}/dashboard`}
        fallbackRedirectUrl={`${basePath}/dashboard`}
      />
    </div>
  );
}

function SignUpPage() {
  const { isLoaded, isSignedIn } = useAuth();

  if (isLoaded && isSignedIn) {
    return <Redirect to="/dashboard" />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
        forceRedirectUrl={`${basePath}/dashboard`}
        fallbackRedirectUrl={`${basePath}/dashboard`}
      />
    </div>
  );
}

function AuthLoadingScreen() {
  return <div className="min-h-screen bg-background" />;
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
      <Switch>
        <Route path="/dashboard" component={Queue} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/mod-log" component={ModLog} />
        <Route path="/config" component={Config} />
        <Route component={NotFound} />
      </Switch>
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
          <WouterRouter base={basePath}>
            <Switch>
              <Route path="/terms" component={Terms} />
              <Route path="/privacy" component={Privacy} />
              <Route>
                <Layout>
                  <Switch>
                    <Route path="/" component={Queue} />
                    <Route path="/analytics" component={Analytics} />
                    <Route path="/mod-log" component={ModLog} />
                    <Route path="/config" component={Config} />
                    <Route component={NotFound} />
                  </Switch>
                </Layout>
              </Route>
            </Switch>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    );
  }

  const fallbackApp = (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
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
