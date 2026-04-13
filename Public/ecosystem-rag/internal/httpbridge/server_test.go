package httpbridge

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWriteJSON(t *testing.T) {
	tests := []struct {
		name       string
		status     int
		data       any
		checkFunc  func(*httptest.ResponseRecorder) bool
	}{
		{
			name:   "write string map",
			status: http.StatusOK,
			data:   map[string]string{"key": "value"},
			checkFunc: func(rec *httptest.ResponseRecorder) bool {
				return rec.Code == http.StatusOK && rec.Header().Get("Content-Type") == "application/json"
			},
		},
		{
			name:   "write with error status",
			status: http.StatusNotFound,
			data:   map[string]string{"error": "not found"},
			checkFunc: func(rec *httptest.ResponseRecorder) bool {
				return rec.Code == http.StatusNotFound
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			writeJSON(rec, tt.status, tt.data)
			assert.True(t, tt.checkFunc(rec), "response check failed")
		})
	}
}

func TestWriteMarkdown(t *testing.T) {
	rec := httptest.NewRecorder()
	content := []byte("# Hello World\n\nThis is markdown.")

	writeMarkdown(rec, content)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Header().Get("Content-Type"), "text/markdown")
	assert.Equal(t, content, rec.Body.Bytes())
}

func TestWriteError(t *testing.T) {
	rec := httptest.NewRecorder()

	writeError(rec, http.StatusBadRequest, "invalid request")

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "invalid request")
	assert.Contains(t, rec.Header().Get("Content-Type"), "application/json")
}

func TestCorsMiddleware(t *testing.T) {
	tests := []struct {
		name          string
		origin        string
		expectedCORS  bool
	}{
		{"allowed localhost 5173", "http://localhost:5173", true},
		{"allowed localhost 3000", "http://localhost:3000", true},
		{"not allowed other", "http://example.com", false},
		{"not allowed empty", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mux := http.NewServeMux()
			mux.HandleFunc("GET /test", func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
			})

			handler := corsMiddleware(mux)

			req := httptest.NewRequest("GET", "/test", nil)
			if tt.origin != "" {
				req.Header.Set("Origin", tt.origin)
			}

			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if tt.expectedCORS {
				assert.Equal(t, tt.origin, rec.Header().Get("Access-Control-Allow-Origin"))
			} else {
				assert.Empty(t, rec.Header().Get("Access-Control-Allow-Origin"))
			}
		})
	}
}

func TestCorsMiddlewareOptions(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /test", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler := corsMiddleware(mux)

	req := httptest.NewRequest("OPTIONS", "/test", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusNoContent, rec.Code)
}

func TestLoggingMiddleware(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /test", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler := loggingMiddleware(mux)

	req := httptest.NewRequest("GET", "/test", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestServerHandlerRoutes(t *testing.T) {
	s := New(nil, "/docs")
	handler := s.Handler()

	require.NotNil(t, handler)

	// Verify routes are registered by checking the handler doesn't panic
	// Note: Routes that need searcher or real files are tested separately
	routes := []struct {
		method string
		path   string
	}{
		{"GET", "/api/services"},
		{"GET", "/api/services/test/overview"},
		{"GET", "/api/services/test/connections"},
		{"GET", "/api/graphs/full-topology"},
		{"GET", "/api/graphs/full-topology/parsed"},
		// /api/search and /api/impact require a real searcher, skip for now
	}

	for _, route := range routes {
		t.Run(route.method+"_"+route.path, func(t *testing.T) {
			req := httptest.NewRequest(route.method, route.path, nil)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			// Just verify it doesn't panic - actual routing tested separately
		})
	}
}

func TestHandleListServicesNonExistentDir(t *testing.T) {
	s := New(nil, "/nonexistent/path")
	handler := s.Handler()

	req := httptest.NewRequest("GET", "/api/services", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	// Should return empty array, not error
	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestHandleGetServiceNotFound(t *testing.T) {
	s := New(nil, "/nonexistent/path")
	handler := s.Handler()

	req := httptest.NewRequest("GET", "/api/services/nonexistent/notfound", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestHandleGetConnectionsNotFound(t *testing.T) {
	s := New(nil, "/nonexistent/path")
	handler := s.Handler()

	req := httptest.NewRequest("GET", "/api/services/test/connections", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestHandleGetGraphNotFound(t *testing.T) {
	s := New(nil, "/nonexistent/path")
	handler := s.Handler()

	req := httptest.NewRequest("GET", "/api/graphs/nonexistent", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestHandleGetGraphParsedNotFound(t *testing.T) {
	s := New(nil, "/nonexistent/path")
	handler := s.Handler()

	req := httptest.NewRequest("GET", "/api/graphs/nonexistent/parsed", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestHandleSearchMissingQuery(t *testing.T) {
	s := New(nil, "/nonexistent/path")
	handler := s.Handler()

	req := httptest.NewRequest("GET", "/api/search", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "query parameter")
}

func TestHandleGetServicePtBrNotFound(t *testing.T) {
	s := New(nil, "/nonexistent/path")
	handler := s.Handler()

	req := httptest.NewRequest("GET", "/api/services/test/pt-br/visao-geral", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestSearchResultJSON(t *testing.T) {
	result := searchResult{
		Service:  "payment-service",
		DocType:  "overview",
		Section:  "Introduction",
		FilePath: "/docs/payment/overview.md",
		Score:    0.95,
		Content:  "Test content",
	}

	// Verify struct fields
	assert.Equal(t, "payment-service", result.Service)
	assert.Equal(t, "overview", result.DocType)
	assert.Equal(t, "Introduction", result.Section)
	assert.Equal(t, "/docs/payment/overview.md", result.FilePath)
	assert.Equal(t, float32(0.95), result.Score)
	assert.Equal(t, "Test content", result.Content)
}

func TestServiceEntryJSON(t *testing.T) {
	entry := serviceEntry{
		Name:     "order-service",
		Category: "services",
		Docs:     []string{"overview", "domain", "events"},
	}

	assert.Equal(t, "order-service", entry.Name)
	assert.Equal(t, "services", entry.Category)
	assert.Len(t, entry.Docs, 3)
}

func TestChatRequestBody(t *testing.T) {
	body := chatRequestBody{
		Message: "Hello",
		Service: "payment-service",
		History: []chatMessage{
			{Role: "user", Content: "Hi"},
			{Role: "assistant", Content: "Hello!"},
		},
	}

	assert.Equal(t, "Hello", body.Message)
	assert.Equal(t, "payment-service", body.Service)
	assert.Len(t, body.History, 2)
}

func TestChatMessage(t *testing.T) {
	msg := chatMessage{
		Role:    "user",
		Content: "Test message",
	}

	assert.Equal(t, "user", msg.Role)
	assert.Equal(t, "Test message", msg.Content)
}

func TestOpenAIChatRequest(t *testing.T) {
	req := openAIChatRequest{
		Model:  "gpt-4",
		Messages: []chatMessage{
			{Role: "system", Content: "You are helpful"},
			{Role: "user", Content: "Hello"},
		},
		Stream: true,
	}

	assert.Equal(t, "gpt-4", req.Model)
	assert.Len(t, req.Messages, 2)
	assert.True(t, req.Stream)
}

func TestSSEEvent(t *testing.T) {
	ev := sseEvent{
		Type:    "token",
		Content: "Hello",
	}

	assert.Equal(t, "token", ev.Type)
	assert.Equal(t, "Hello", ev.Content)
}

func TestServerNew(t *testing.T) {
	server := New(nil, "")
	assert.NotNil(t, server)
	assert.Equal(t, "", server.docsDir)
	assert.Nil(t, server.searcher)
}

func TestServerNewWithDocsDir(t *testing.T) {
	server := New(nil, "/path/to/docs")
	assert.NotNil(t, server)
	assert.Equal(t, "/path/to/docs", server.docsDir)
}
