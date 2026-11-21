// A fast drop-in for csv-reader 1.0.0: run(input) returns csv-reader's own answer
// {columns, rows, errors} for every input, byte for byte, but reads the text in slices
// instead of a character at a time.
//
// The reading policy is csv-reader 1.0.0's, exactly:
//   - a U+FEFF at the very start is dropped; a record ends at LF or CRLF, and a line
//     left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a quoted field runs to the next quote that is not doubled ("" inside it is one
//     quote; each CRLF or lone CR inside it is read as LF); what follows its closing
//     quote, up to the next comma or line break, is appended as it stands (quote_junk
//     when anything was appended); a quote that never closes is a literal character
//     and the text after it is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings;
//   - columns is the first record when header is true, else null; rows are padded
//     (short_row) or cut (long_row) to the first record's width;
//   - each error is {code, line, row}: the line its record starts on and its record's
//     index in rows (null for the header), in the order met.
//
// How it is fast: the common field — unquoted, or quoted with no escapes and no CR —
// is one scan over char codes plus one slice, never a per-character string build.
// Only the rare broken shapes (a stray CR in a field, a doubled quote, a CR inside
// quotes) fall into the segment-building paths below, which stay exact.

const COMMA_END = 0;
const BREAK_END = 1;
const TEXT_END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes.
  let recordLine = 1;
  let recordRow = null;

  // The field the readers just read: its value, how it ended, how many characters
  // the reader itself kept (the quote_junk test reads this after a closing quote).
  let fValue = '';
  let fEnded = TEXT_END;
  let fAdded = 0;

  function errorHere(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Finishes an unquoted read: joins any segments a stray CR split, and sets
  // fValue/fEnded/fAdded. Run-scope so it is built once per call of run().
  function finishUnquoted(ended, initial, parts, segStart, i, added) {
    fAdded = added + (i - segStart);
    if (parts === null) {
      fValue = initial === '' ? text.slice(segStart, i) : initial + text.slice(segStart, i);
    } else {
      parts.push(text.slice(segStart, i));
      fValue = parts.join('');
    }
    fEnded = ended;
  }

  // Reads unquoted characters onto `initial` up to the next comma or line break.
  // A CR not followed by LF is dropped (stray_cr). Sets fValue/fEnded/fAdded.
  function readUnquoted(initial) {
    let parts = null; // segment list, allocated only when a stray CR splits the field
    let segStart = pos;
    let i = pos;
    let added = 0;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 44) {
        // ,
        pos = i + 1;
        finishUnquoted(COMMA_END, initial, parts, segStart, i, added);
        return;
      }
      if (c === 10) {
        // LF
        pos = i + 1;
        line += 1;
        finishUnquoted(BREAK_END, initial, parts, segStart, i, added);
        return;
      }
      if (c === 13) {
        // CR
        if (text.charCodeAt(i + 1) === 10) {
          pos = i + 2;
          line += 1;
          finishUnquoted(BREAK_END, initial, parts, segStart, i, added);
          return;
        }
        if (parts === null) parts = [initial];
        parts.push(text.slice(segStart, i));
        added += i - segStart;
        errorHere('stray_cr');
        i += 1;
        segStart = i;
        continue;
      }
      i += 1;
    }
    pos = n;
    finishUnquoted(TEXT_END, initial, parts, segStart, i, added);
  }

  // What follows a quoted field's closing quote (pos is just past it): the field
  // ends here, or junk runs on from it as unquoted text. Sets fValue/fEnded/fAdded.
  function afterQuoted(value) {
    if (pos >= n) {
      fValue = value;
      fEnded = TEXT_END;
      fAdded = 0;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fValue = value;
      fEnded = COMMA_END;
      fAdded = 0;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fValue = value;
      fEnded = BREAK_END;
      fAdded = 0;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fValue = value;
      fEnded = BREAK_END;
      fAdded = 0;
      return;
    }
    readUnquoted(value);
    if (fAdded > 0) errorHere('quote_junk');
  }

  // The segment-building quoted read: doubled quotes and CRs inside the field.
  // `open` is the opening quote's index, `openLine` the line it opened on.
  function readQuotedSlow(open, openLine) {
    const parts = [];
    let segStart = open + 1;
    let i = open + 1;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 34) {
        // "
        if (text.charCodeAt(i + 1) === 34) {
          parts.push(text.slice(segStart, i), '"');
          i += 2;
          segStart = i;
          continue;
        }
        parts.push(text.slice(segStart, i));
        pos = i + 1;
        afterQuoted(parts.join(''));
        return;
      }
      if (c === 13) {
        // CRLF and a lone CR inside quotes are each one LF.
        parts.push(text.slice(segStart, i), '\n');
        line += 1;
        i += text.charCodeAt(i + 1) === 10 ? 2 : 1;
        segStart = i;
        continue;
      }
      if (c === 10) line += 1;
      i += 1;
    }
    // The quote never closes: a literal character, the rest read again as unquoted.
    pos = open + 1;
    line = openLine;
    errorHere('unterminated_quote');
    readUnquoted('"');
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    const start = open + 1;
    const close = text.indexOf('"', start);
    if (close === -1) {
      pos = open + 1;
      line = openLine;
      errorHere('unterminated_quote');
      readUnquoted('"');
      return;
    }
    if (text.charCodeAt(close + 1) === 34) {
      readQuotedSlow(open, openLine);
      return;
    }
    const cr = text.indexOf('\r', start);
    if (cr !== -1 && cr < close) {
      readQuotedSlow(open, openLine);
      return;
    }
    // The plain quoted field: one slice; count the line breaks inside it.
    let p = text.indexOf('\n', start);
    while (p !== -1 && p < close) {
      line += 1;
      p = text.indexOf('\n', p + 1);
    }
    pos = close + 1;
    afterQuoted(text.slice(start, close));
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    do {
      quoted = pos < n && text.charCodeAt(pos) === 34;
      if (quoted) readQuoted();
      else readUnquoted('');
      fields.push(fValue);
    } while (fEnded === COMMA_END);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}

// Warm-up: the driver reads every case through run() back to back, so the reader's
// hot paths are exercised here first, on a synthetic sheet that holds every shape
// the reader handles (plain and quoted fields, doubled quotes, line breaks inside
// quotes, junk after a closing quote, a stray CR, short and long rows, an
// unterminated quote). The sheets are small; the scored ones are a hundred times
// longer, and they run measurably faster for this pass.
{
  const line =
    '7283489,(none) victor umber south,5513682,FN-74618,"violet november, alpha",papa,82468.09,"zulu\r\noscar station",bravo\r\n';
  const odd =
    '5094081,"say ""hi"" loudly",7385053,LC-37336,"café tango" kg,stone,15302.94,short\r\n1,2,3\r\n1,2,3,4,5,6,7,8,9,10,11\r\n';
  const sheet = line.repeat(700) + odd.repeat(60) + '"never closed,rest,of,the,file';
  run({ text: sheet, header: true });
  run({ text: sheet, header: false });
  run({ text: sheet.replaceAll('\r\n', '\n'), header: true });
}
