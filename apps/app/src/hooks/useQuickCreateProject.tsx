import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useCreateProject } from "@/hooks/mutations/project-mutations";
import {
  APP_ROOT_ROUTE_PATH,
  getRootComposeRoutePath,
} from "@/lib/route-paths";
import { useSetRootComposeProjectId } from "@/lib/root-compose-selection";

interface QuickCreateProjectController {
  isAvailable: boolean;
  isCreating: boolean;
  openCreateDialog: () => void;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  createProject: (name: string) => void;
}

const quickCreateProjectContext =
  createContext<QuickCreateProjectController | null>(null);

export function useQuickCreateProject(): QuickCreateProjectController {
  const { mutate, isPending } = useCreateProject();
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const setRootComposeProjectId = useSetRootComposeProjectId();
  const shouldReplaceRoute = location.pathname === APP_ROOT_ROUTE_PATH;

  const createProject = useCallback(
    (name: string) => {
      if (isPending || !name.trim()) return;
      mutate(
        { name: name.trim() },
        {
          onSuccess: (project) => {
            setIsOpen(false);
            setRootComposeProjectId(project.id);
            void navigate(getRootComposeRoutePath(), {
              replace: shouldReplaceRoute,
            });
          },
        },
      );
    },
    [isPending, mutate, navigate, setRootComposeProjectId, shouldReplaceRoute],
  );
  const openCreateDialog = useCallback(() => setIsOpen(true), []);
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!isPending) setIsOpen(open);
    },
    [isPending],
  );
  return useMemo(
    () => ({
      isAvailable: true,
      isCreating: isPending,
      isOpen,
      onOpenChange,
      openCreateDialog,
      createProject,
    }),
    [createProject, isOpen, isPending, onOpenChange, openCreateDialog],
  );
}

interface QuickCreateProjectProviderProps {
  children: ReactNode;
}

export function QuickCreateProjectProvider({
  children,
}: QuickCreateProjectProviderProps) {
  const quickCreateProject = useQuickCreateProject();

  return (
    <quickCreateProjectContext.Provider value={quickCreateProject}>
      {children}
    </quickCreateProjectContext.Provider>
  );
}

export function useQuickCreateProjectController(): QuickCreateProjectController {
  const quickCreateProject = useContext(quickCreateProjectContext);
  if (!quickCreateProject) {
    throw new Error("QuickCreateProjectProvider is required");
  }
  return quickCreateProject;
}
