export type MdkErrorCode =
  | "INVALID_PATH"
  | "INVALID_CONTAINER"
  | "UNSUPPORTED_VERSION"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "SECTION_NOT_FOUND"
  | "INVALID_ARGUMENT"
  | "SQLITE";

export class MdkError extends Error {
  constructor(public readonly code: MdkErrorCode, message: string) {
    super(message);
    this.name = "MdkError";
  }
}
