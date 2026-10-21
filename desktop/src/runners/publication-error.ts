export class TutorPublicationError extends Error {
  constructor(readonly detail: string) {
    super("The response could not be prepared. Please retry your message.")
  }
}
