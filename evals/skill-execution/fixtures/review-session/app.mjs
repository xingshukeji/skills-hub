import { EventEmitter } from 'node:events';
export function createEventSource() { return new EventEmitter(); }
export function openSession(source) {
  const messages = [];
  function receive(message) { messages.push(message); }
  source.on('message', message => receive(message));
  return { messages, close() { source.off('message', receive); } };
}
