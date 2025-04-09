import { useState, useEffect } from "react";
import { AuthForm } from "./components/AuthForm";
import { LiveControlPanel } from "./components/LiveControlPanel";
import { useAuth } from "./hooks/useAuth";
import { Button } from "./components/ui/button";
import { cn } from "./lib/utils";

export default function App() {
  const { isAuthenticated, user, isLoading, logout } = useAuth();
  const [showAuth, setShowAuth] = useState(false);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="w-full py-4 px-6 border-b border-secondary">
        <div className="flex justify-between items-center">
          <h1 className="text-xl font-bold">Audio Recorder</h1>
          {isAuthenticated && (
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">
                {user}
              </span>
              <Button variant="outline" size="sm" onClick={logout}>
                Logout
              </Button>
            </div>
          )}
        </div>
      </header>
      
      {/* Main content */}
      <main className="flex-1 flex items-center justify-center p-6">
        <div className={`w-full ${isAuthenticated ? "max-w-3xl" : "flex justify-center"}`}>
          {isLoading ? (
            <div className="flex justify-center">
              <div className="animate-pulse bg-muted h-64 w-full max-w-md rounded-md" />
            </div>
          ) : isAuthenticated ? (
            <LiveControlPanel />
          ) : (
            <AuthForm />
          )}
        </div>
      </main>
      
      {/* Footer */}
      <footer className="w-full py-4 px-6 border-t border-secondary">
        <div className="max-w-6xl mx-auto">
          <p className="text-center text-sm text-muted-foreground">
            © {new Date().getFullYear()} Audio Recorder for AugmentOS
          </p>
        </div>
      </footer>
    </div>
  );
}