// One place for the generated Go bindings and the types the UI uses.
import * as Gitdeck from "../../bindings/gitdeck/gitdeck";
export { Gitdeck };
export type { ProjectInfo, RepoChanged } from "../../bindings/gitdeck/models";
export type { Branch, ChangedFile, Commit, Diff, File, Hunk, Line, Stash, Status } from "../../bindings/gitdeck/internal/git/models";
export type { Project, State } from "../../bindings/gitdeck/internal/store/models";

/** Turns a rejected Wails call into a readable message. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Something went wrong";
}
