export const BB_THREAD_ORIGIN_TINT = {
  light: "oklch(from var(--ink) 0.48 0.2 300)",
  dark: "oklch(from var(--ink) 0.76 0.16 300)",
};
export const BB_THREAD_ORIGIN_COLOR = `light-dark(${BB_THREAD_ORIGIN_TINT.light}, ${BB_THREAD_ORIGIN_TINT.dark})`;

export function threadOrigin(
  creationSource: "bb" | "native" | undefined,
  providerId: string,
) {
  if (creationSource === "native") {
    const label = providerId === "codex" ? "Codex" : providerId;
    return { label, description: `Imported from ${label}` };
  }
  return { label: "bb", description: "Created in bb" };
}
