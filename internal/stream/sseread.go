package stream

import (
	"bufio"
	"io"
	"strings"
)

// Message is one parsed SSE message. Used by tests and by the Vercel smoke
// test tool; the browser uses its built-in EventSource instead.
type Message struct {
	ID    string
	Event string
	Data  string
}

// ReadMessages parses an SSE body and sends each complete message to fn until
// the body ends or fn returns false. Comment lines (": ping") are skipped.
func ReadMessages(body io.Reader, fn func(Message) bool) error {
	sc := bufio.NewScanner(body)
	sc.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	var m Message
	var data []string
	for sc.Scan() {
		line := sc.Text()
		switch {
		case line == "":
			if m.Event != "" || len(data) > 0 {
				m.Data = strings.Join(data, "\n")
				if !fn(m) {
					return nil
				}
			}
			m, data = Message{}, nil
		case strings.HasPrefix(line, ":"):
		case strings.HasPrefix(line, "id:"):
			m.ID = strings.TrimSpace(line[3:])
		case strings.HasPrefix(line, "event:"):
			m.Event = strings.TrimSpace(line[6:])
		case strings.HasPrefix(line, "data:"):
			data = append(data, strings.TrimPrefix(line[5:], " "))
		}
	}
	return sc.Err()
}
