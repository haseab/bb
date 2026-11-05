// @vitest-environment jsdom

import { useRef, useState, type ComponentProps } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { NewThreadProjectFlow } from "./NewThreadProjectFlow";

type FlowProps = ComponentProps<typeof NewThreadProjectFlow>;
const projects = [
  { id: "alpha", name: "Alpha Web" },
  { id: "bb", name: "BB" },
  { id: PERSONAL_PROJECT_ID, name: "Personal" },
];

function Flow({
  onSelectProject = async () => {},
  ...props
}: Partial<FlowProps>) {
  const [choosing, setChoosing] = useState(true);
  const [projectId, setProjectId] = useState("bb");
  const composer = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("Existing draft");
  return (
    <NewThreadProjectFlow
      projects={projects}
      projectId={projectId}
      choosing={choosing}
      onChoosingChange={setChoosing}
      resetRequest={null}
      autoFocus
      onSelectProject={async (id) => {
        await onSelectProject(id);
        setProjectId(id);
      }}
      onCompose={() => composer.current?.focus()}
      onCreateProject={() => {}}
      canCreateProject
      {...props}
    >
      <textarea
        aria-label="Message"
        ref={composer}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </NewThreadProjectFlow>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const search = () => screen.getByRole("combobox", { name: "Search projects" });

async function openPicker() {
  await waitFor(() => expect(document.activeElement).toBe(search()));
  await screen.findByRole("listbox");
}

it("starts in search, filters with the keyboard, and focuses the composer after Enter", async () => {
  const select = vi.fn(async () => {});
  render(<Flow onSelectProject={select} />);
  await openPicker();
  expect(document.activeElement).toBe(search());
  expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
  fireEvent.change(search(), { target: { value: "Alpha" } });
  await waitFor(() =>
    expect(screen.queryByRole("option", { name: /BB/ })).toBeNull(),
  );
  fireEvent.keyDown(search(), { key: "Enter" });
  await waitFor(() => expect(select).toHaveBeenCalledWith("alpha"));
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Message" }),
    ),
  );
  expect(screen.getByText("Alpha Web")).toBeTruthy();
});

it("preselects No project first and supports arrow navigation", async () => {
  const select = vi.fn(async () => {});
  render(<Flow onSelectProject={select} />);
  await openPicker();
  expect(screen.getAllByRole("option")[0]?.textContent).toBe("No project");
  expect(screen.getAllByRole("option")[0]?.getAttribute("aria-selected")).toBe(
    "true",
  );
  fireEvent.keyDown(search(), { key: "ArrowDown" });
  fireEvent.keyDown(search(), { key: "Enter" });
  await waitFor(() => expect(select).toHaveBeenCalledWith("bb"));
});

it("supports a personal workspace and changing projects without losing the message", async () => {
  render(<Flow />);
  await openPicker();
  fireEvent.change(search(), { target: { value: "No project" } });
  fireEvent.keyDown(search(), { key: "Enter" });
  await screen.findByText("Personal workspace");
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Keep this draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Change project" }));
  await openPicker();
  fireEvent.click(screen.getByRole("option", { name: /Alpha Web/ }));
  expect(
    (
      (await screen.findByRole("textbox", {
        name: "Message",
      })) as HTMLTextAreaElement
    ).value,
  ).toBe("Keep this draft");
});

it("clears an empty search result with Escape and keeps the picker open", async () => {
  render(<Flow />);
  await openPicker();
  fireEvent.change(search(), { target: { value: "zzzzzz" } });
  expect(screen.getByText("No projects found. Try another name.")).toBeTruthy();
  fireEvent.keyDown(search(), { key: "Escape" });
  expect((search() as HTMLInputElement).value).toBe("");
  expect(screen.getByRole("option", { name: /Alpha Web/ })).toBeTruthy();
});

it("keeps the picker usable after a failed project change", async () => {
  render(
    <Flow
      onSelectProject={async () => {
        throw new Error("Attachments could not be copied");
      }}
    />,
  );
  await openPicker();
  fireEvent.keyDown(search(), { key: "Enter" });
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Attachments could not be copied",
  );
  expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
});

it("does not submit twice while a project change is pending", async () => {
  let resolve: (() => void) | undefined;
  const select = vi.fn(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  render(<Flow onSelectProject={select} />);
  await openPicker();
  fireEvent.keyDown(search(), { key: "Enter" });
  fireEvent.keyDown(search(), { key: "Enter" });
  expect(select).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Preparing your workspace…")).toBeTruthy();
  await act(async () => resolve?.());
  expect(await screen.findByRole("textbox", { name: "Message" })).toBeTruthy();
});

it("returns to project search for another New thread request", async () => {
  const { rerender } = render(<Flow />);
  await openPicker();
  fireEvent.keyDown(search(), { key: "Enter" });
  await screen.findByRole("textbox", { name: "Message" });
  rerender(<Flow resetRequest="new-request" />);
  await openPicker();
  expect(search()).toBe(document.activeElement);
  expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
});

it("shows loading and offers no-project and creation when the project list is empty", async () => {
  const create = vi.fn();
  const { rerender } = render(
    <Flow projects={undefined} onCreateProject={create} />,
  );
  await openPicker();
  expect(screen.getByText("Loading projects…")).toBeTruthy();
  rerender(<Flow projects={[]} onCreateProject={create} />);
  fireEvent.click(screen.getByRole("option", { name: "New project" }));
  expect(create).toHaveBeenCalledOnce();
  expect(screen.getByRole("option", { name: /No project/ })).toBeTruthy();
});

it("keeps No project highlighted when project loading finishes", async () => {
  const select = vi.fn(async () => {});
  const { rerender } = render(
    <Flow projects={undefined} onSelectProject={select} />,
  );
  await openPicker();
  rerender(<Flow onSelectProject={select} />);
  expect(document.activeElement).toBe(search());
  fireEvent.keyDown(search(), { key: "Enter" });
  await waitFor(() => expect(select).toHaveBeenCalledWith(PERSONAL_PROJECT_ID));
});

it("focuses search immediately and animates only the project list open after 200 ms", () => {
  vi.useFakeTimers();
  render(<Flow />);
  expect(document.activeElement).toBe(search());
  expect(search().getAttribute("aria-expanded")).toBe("false");
  const options = document.querySelector("[data-project-options-state]");
  expect(options?.getAttribute("data-project-options-state")).toBe("closed");
  expect(options?.className).toContain(
    "transition-[grid-template-rows,opacity]",
  );
  expect(options?.className).toContain("motion-reduce:transition-none");
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.change(search(), { target: { value: "Alpha" } });
  act(() => vi.advanceTimersByTime(199));
  expect(document.activeElement).toBe(search());
  expect(screen.queryByRole("listbox")).toBeNull();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByRole("listbox")).toBeTruthy();
  expect(options?.getAttribute("data-project-options-state")).toBe("open");
  expect(search().getAttribute("aria-expanded")).toBe("true");
  expect((search() as HTMLInputElement).value).toBe("Alpha");
  expect(screen.getByRole("option", { name: /Alpha Web/ })).toBeTruthy();
  expect(screen.queryByRole("option", { name: /BB/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Choose project" })).toBeNull();
  expect(screen.queryByText("Where would you like to work?")).toBeNull();
});

it.each([projects, undefined])(
  "Enter immediately selects No project before the list opens, even while projects are loading (%j)",
  async (available) => {
    const select = vi.fn(async () => {});
    render(<Flow projects={available} onSelectProject={select} />);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(search());
    fireEvent.keyDown(search(), { key: "Enter" });
    await waitFor(() =>
      expect(select).toHaveBeenCalledWith(PERSONAL_PROJECT_ID),
    );
    expect(
      await screen.findByRole("textbox", { name: "Message" }),
    ).toBeTruthy();
  },
);
