import { Data } from "effect";

export class NoSceneDataError extends Data.TaggedError("NoSceneDataError")<{
  readonly filePath: string;
  readonly format: string;
}> {}

export class DecodeError extends Data.TaggedError("DecodeError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class UnsupportedFormatError extends Data.TaggedError(
  "UnsupportedFormatError",
)<{
  readonly filePath: string;
}> {}

export class FileReadError extends Data.TaggedError("FileReadError")<{
  readonly filePath: string;
  readonly cause: unknown;
}> {}

export class InvalidSceneError extends Data.TaggedError("InvalidSceneError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class EncodeError extends Data.TaggedError("EncodeError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class RenderError extends Data.TaggedError("RenderError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class FileWriteError extends Data.TaggedError("FileWriteError")<{
  readonly filePath: string;
  readonly cause: unknown;
}> {}
