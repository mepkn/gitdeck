import { useCallback, useEffect, useState } from "react";
import { Events } from "@wailsio/runtime";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmProvider } from "@/components/Confirm";
import { ProjectsView } from "@/components/ProjectsView";
import { Workspace } from "@/components/Workspace";
import { Gitdeck, errorMessage, type State } from "@/lib/api";

export default function App() {
  const [state, setState] = useState<State | null>(null);

  const reload = useCallback(() => {
    Gitdeck.State()
      .then(setState)
      .catch((e) => toast.error(errorMessage(e)));
  }, []);

  useEffect(() => {
    reload();
    // A gitdeck:// link (from agentdeck) opened a project.
    return Events.On("project:opened", reload);
  }, [reload]);

  const open = async (path: string) => {
    try {
      setState(await Gitdeck.OpenProject(path));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const close = async () => {
    setState(await Gitdeck.CloseProject());
  };

  return (
    <TooltipProvider>
      <ConfirmProvider>
        {state &&
          (state.active ? (
            <Workspace key={state.active} state={state} onState={setState} onOpen={open} onClose={close} />
          ) : (
            <ProjectsView state={state} onState={setState} onOpen={open} />
          ))}
        <Toaster position="bottom-left" />
      </ConfirmProvider>
    </TooltipProvider>
  );
}
