// Helper (not run by itself): reads a Server-Sent Events response with fetch streaming.
// Node 24 has no EventSource unless you pass --experimental-eventsource, so we parse the
// text/event-stream format ourselves. The format is tiny: blocks separated by a blank line.
//
//   const res = await fetch(url);
//   for await (const msg of readEvents(res)) console.log(msg.event, msg.data);
//
// Each result is { event, data, id, retry, comments }. A block with no "data:" line (a
// comment heartbeat, or a lone "retry:") has data === null; a browser EventSource hides those.

async function* readEvents(response) {
  const decoder = new TextDecoder(); // stream: true keeps half a character between chunks
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    buffer = buffer.replace(/\r\n/g, '\n');
    let end;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      yield parseBlock(block);
    }
  }
}

function parseBlock(block) {
  const message = { event: 'message', data: null, id: null, retry: null, comments: [] };
  const dataLines = [];
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) {
      message.comments.push(line.slice(1).trim());
      continue;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1); // only ONE leading space is removed
    if (field === 'data') dataLines.push(value);
    else if (field === 'event') message.event = value;
    else if (field === 'id') message.id = value;
    else if (field === 'retry') message.retry = Number(value);
  }
  if (dataLines.length) message.data = dataLines.join('\n');
  return message;
}

module.exports = { readEvents, parseBlock };
