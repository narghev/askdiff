import { useWebSocket } from "./hooks/use-websocket";
import { TopBar } from "./components/TopBar";
import { StaleBanner } from "./components/StaleBanner";
import { FileTree } from "./components/FileTree";
import { DiffPane } from "./components/DiffPane";
import { Toaster } from "./components/Toaster";

export const App = () => {
  useWebSocket();

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <StaleBanner />
      <div className="flex min-h-0 flex-1">
        <FileTree />
        <main className="min-w-0 flex-1 overflow-auto">
          <DiffPane />
        </main>
      </div>
      <Toaster />
    </div>
  );
};
