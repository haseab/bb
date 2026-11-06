import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { deriveProjectNameFromPath, type Host } from "@bb/domain";
import type { HostPlatform } from "@bb/host-daemon-contract";
import { useCreateProject } from "@/hooks/mutations/project-mutations";
import { selectHosts, useHosts } from "@/hooks/queries/host-queries";
import {
  useLocalPathPicker,
  type LocalPathSubmitParams,
} from "@/hooks/useLocalPathPicker";
import {
  APP_ROOT_ROUTE_PATH,
  getRootComposeRoutePath,
} from "@/lib/route-paths";
import { useSetRootComposeProjectId } from "@/lib/root-compose-selection";
import type {
  ProjectPathDialogSubmitHandler,
  ProjectPathDialogTarget,
} from "@/components/dialogs/ProjectPathDialog";

interface QuickCreateProjectDialogState {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  target: ProjectPathDialogTarget | null;
}

interface ProjectCreateObserver {
  onStarted: () => void;
  onSettled: (
    result: { outcome: "succeeded" } | { outcome: "failed"; error: unknown },
  ) => void;
}

interface QuickCreateProjectController {
  isAvailable: boolean;
  isCreating: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  createProject: (name: string) => void;
  openCreateDialog: () => void;
  openObservedCreateDialog: (observer: ProjectCreateObserver) => void;
  openCreateDialogThen: (onCreated: (projectId: string) => void) => void;
  platform: HostPlatform | null;
  hostId: string | null;
  hostName: string | null;
  hosts: readonly Host[];
  projectPathDialog: QuickCreateProjectDialogState;
  submitProjectPath: ProjectPathDialogSubmitHandler;
}

const quickCreateProjectContext =
  createContext<QuickCreateProjectController | null>(null);

export function useQuickCreateProject(): QuickCreateProjectController {
  const { mutate, isPending } = useCreateProject();
  const [isOpen, setIsOpen] = useState(false);
  const hostsQuery = useHosts();
  const hosts = useMemo(
    () => selectHosts(hostsQuery.data, "all"),
    [hostsQuery.data],
  );
  const navigate = useNavigate();
  const location = useLocation();
  const setRootComposeProjectId = useSetRootComposeProjectId();
  const shouldReplaceRoute = location.pathname === APP_ROOT_ROUTE_PATH;
  const observerRef = useRef<ProjectCreateObserver | null>(null);
  const onCreatedRef = useRef<((projectId: string) => void) | null>(null);

  const submit = useCallback(
    ({ path, hostId, target, closeDialog }: LocalPathSubmitParams) => {
      if (target.kind !== "create") return;
      const name = deriveProjectNameFromPath(path).trim();
      if (!name) return;

      const observer = observerRef.current;
      observer?.onStarted();
      mutate(
        {
          name,
          source: { type: "local_path", hostId, path },
        },
        {
          onSuccess: (project) => {
            observer?.onSettled({ outcome: "succeeded" });
            closeDialog();
            const onCreated = onCreatedRef.current;
            onCreatedRef.current = null;
            if (onCreated) {
              onCreated(project.id);
              return;
            }
            setRootComposeProjectId(project.id);
            void navigate(getRootComposeRoutePath(), {
              replace: shouldReplaceRoute,
            });
          },
          onError: (error) => observer?.onSettled({ outcome: "failed", error }),
        },
      );
    },
    [mutate, navigate, setRootComposeProjectId, shouldReplaceRoute],
  );

  const controller = useLocalPathPicker({
    isPending,
    submit,
  });

  const openCreateDialog = useCallback(() => {
    observerRef.current = null;
    onCreatedRef.current = null;
    setIsOpen(true);
  }, []);

  const openObservedCreateDialog = useCallback(
    (observer: ProjectCreateObserver) => {
      observerRef.current = observer;
      onCreatedRef.current = null;
      controller.openPathEntry({ kind: "create" });
    },
    [controller],
  );
  const openCreateDialogThen = useCallback(
    (onCreated: (projectId: string) => void) => {
      observerRef.current = null;
      onCreatedRef.current = onCreated;
      setIsOpen(true);
    },
    [],
  );
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!isPending) setIsOpen(open);
    },
    [isPending],
  );
  const createProject = useCallback(
    (name: string) => {
      if (isPending || !name.trim()) return;
      mutate(
        { name: name.trim() },
        {
          onSuccess: (project) => {
            setIsOpen(false);
            const onCreated = onCreatedRef.current;
            onCreatedRef.current = null;
            if (onCreated) {
              onCreated(project.id);
              return;
            }
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

  return useMemo(
    () => ({
      isAvailable: true,
      isOpen,
      onOpenChange,
      createProject,
      isCreating: isPending,
      openCreateDialog,
      openObservedCreateDialog,
      openCreateDialogThen,
      platform: controller.platform,
      hostId: controller.hostId,
      hostName: controller.hostName,
      hosts,
      projectPathDialog: controller.projectPathDialog,
      submitProjectPath: controller.submitProjectPath,
    }),
    [
      isOpen,
      onOpenChange,
      createProject,
      controller,
      hosts,
      isPending,
      openCreateDialog,
      openCreateDialogThen,
      openObservedCreateDialog,
    ],
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
