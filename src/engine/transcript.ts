import type { Message } from "../world/schema.js";

/** Append a message, returning a new transcript array. */
export function appendMessage(
  transcript: Message[],
  message: Message,
): Message[] {
  return [...transcript, message];
}

/**
 * Return the most recent `maxMessages` entries of the transcript. Game facts
 * live in the state digest, so trimming here is lossless for state — it only
 * bounds the conversational context sent to the model.
 */
export function windowTranscript(
  transcript: Message[],
  maxMessages: number,
): Message[] {
  if (maxMessages <= 0) return [];
  return transcript.slice(-maxMessages);
}
