import type { Message } from "../world/schema.js";
import { notImplemented } from "../util/notImplemented.js";

/** Append a message, returning a new transcript array. */
export function appendMessage(
  _transcript: Message[],
  _message: Message,
): Message[] {
  return notImplemented("engine/transcript.appendMessage");
}

/**
 * Return the most recent slice of the transcript that fits the model context
 * budget. Game facts live in the digest, so trimming here is lossless for
 * state.
 *
 * TODO: window by message count / token estimate.
 */
export function windowTranscript(
  _transcript: Message[],
  _maxMessages: number,
): Message[] {
  return notImplemented("engine/transcript.windowTranscript");
}
