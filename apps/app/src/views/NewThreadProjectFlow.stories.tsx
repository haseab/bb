import { useRef, useState } from "react";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { NewThreadProjectFlow } from "./NewThreadProjectFlow";

export default { title: "New thread/Project first" };

function ProjectFirstPreview({ empty = false }: { empty?: boolean }) {
  const [projectId, setProjectId] = useState("bb");
  const [choosing, setChoosing] = useState(true);
  const [draft, setDraft] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="mx-auto w-full max-w-[760px] px-4">
      <NewThreadProjectFlow
        projects={
          empty
            ? []
            : [
                { id: "bb", name: "BB" },
                { id: "website", name: "Personal website" },
                { id: "research", name: "Research notes" },
                { id: PERSONAL_PROJECT_ID, name: "Personal" },
              ]
        }
        projectId={projectId}
        choosing={choosing}
        onChoosingChange={setChoosing}
        resetRequest={null}
        autoFocus
        onSelectProject={async (id) => setProjectId(id)}
        onCompose={() => composerRef.current?.focus()}
        onCreateProject={() => {}}
        canCreateProject
      >
        <textarea
          ref={composerRef}
          aria-label="Message"
          placeholder="What would you like to work on?"
          className="min-h-40 w-full resize-y rounded-xl border border-border bg-background p-4 text-sm outline-none focus:border-ring"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </NewThreadProjectFlow>
    </div>
  );
}

export const Projects = () => <ProjectFirstPreview />;
export const Empty = () => <ProjectFirstPreview empty />;
