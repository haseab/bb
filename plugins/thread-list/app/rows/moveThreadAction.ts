import { useMemo } from "react";
import { moveThreadToSection } from "./moveThreadToSection.js";
import { captureThreadPipelinePositions } from "../pipeline/threadPipelineAnimation.js";
import { useAtomValue } from "jotai";
import { toast } from "sonner";
import {
  experimental_THREAD_ACTION_GROUPS,
  experimental_useSidebarThreads,
  type PluginThreadActionRegistration,
} from "@get-bb/plugin-sdk/app";
import {
  buildSidebarEntitySectionId,
  normalizeSidebarSectionOrder,
} from "../model/sidebar-section-order.js";
import {
  sidebarManualSectionOrderAtom,
  sidebarOrganizationModeAtom,
  sidebarThreadsSectionLabelAtom,
} from "../preferences/atoms.js";
import { usePreferencesSync } from "../preferences/PreferencesSync.js";

export interface ThreadSectionMoveDestination {
  label: string;
  sectionId: string | null;
}

const THREADS_CHOICE_ID = "threads";

function choiceId(sectionId: string | null): string {
  return sectionId ?? THREADS_CHOICE_ID;
}

export function useMoveDestinations():
  | readonly ThreadSectionMoveDestination[]
  | null {
  usePreferencesSync();
  const mode = useAtomValue(sidebarOrganizationModeAtom);
  const threadsLabel = useAtomValue(sidebarThreadsSectionLabelAtom);
  const storedOrder = useAtomValue(sidebarManualSectionOrderAtom);
  const { sections } = experimental_useSidebarThreads();
  const destinations =
    mode === "chronological"
      ? normalizeSidebarSectionOrder({
          storedOrder,
          entitySectionIds: sections.map((section) =>
            buildSidebarEntitySectionId("section", section.id),
          ),
          legacyEntityAnchor: "sections",
          hasPinnedSection: true,
        }).flatMap<ThreadSectionMoveDestination>((id) => {
          if (id === "threads")
            return [{ label: threadsLabel, sectionId: null }];
          const section = sections.find(
            (candidate) =>
              buildSidebarEntitySectionId("section", candidate.id) === id,
          );
          return section
            ? [{ label: section.name, sectionId: section.id }]
            : [];
        })
      : null;
  const key = JSON.stringify(destinations);
  return useMemo(
    () => JSON.parse(key) as readonly ThreadSectionMoveDestination[] | null,
    [key],
  );
}

export const moveThreadAction: PluginThreadActionRegistration<
  readonly ThreadSectionMoveDestination[] | null
> = {
  id: "move",
  title: "Move to",
  icon: "SectionMove",
  group: experimental_THREAD_ACTION_GROUPS.organize,
  order: 50,
  useData: useMoveDestinations,
  item: ({ thread, data: destinations, sdk }) => {
    if (destinations === null || thread.archivedAt !== null) {
      return null;
    }
    const isCurrent = (sectionId: string | null) =>
      thread.pinnedAt === null &&
      thread.parentThreadId === null &&
      thread.sectionId === sectionId;
    if (destinations.every((destination) => isCurrent(destination.sectionId))) {
      return null;
    }
    return {
      label: "Move to",
      icon: "SectionMove",
      choices: {
        items: destinations.map((destination) => ({
          id: choiceId(destination.sectionId),
          label: destination.label,
          selected: isCurrent(destination.sectionId),
          disabled: isCurrent(destination.sectionId),
        })),
      },
      run: ({ value }) => {
        const destination = destinations.find(
          (candidate) => choiceId(candidate.sectionId) === value,
        );
        if (destination === undefined) return;
        captureThreadPipelinePositions();
        void moveThreadToSection(sdk, thread, destination.sectionId).catch(
          () => {
            toast.error("Failed to move thread.");
          },
        );
      },
    };
  },
};
