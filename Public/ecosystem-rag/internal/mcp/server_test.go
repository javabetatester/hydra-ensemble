package mcp

import (
	"testing"

	"github.com/meucontrole-ai/ecosystem-rag/internal/searcher"
	"github.com/stretchr/testify/assert"
)

func TestNewServer(t *testing.T) {
	s := searcher.New(nil, nil)
	server := NewServer(s, "/docs")

	assert.NotNil(t, server)
	assert.Equal(t, s, server.searcher)
	assert.Equal(t, "/docs", server.docsDir)
}

func TestServerStructure(t *testing.T) {
	server := &Server{
		searcher: nil,
		docsDir:  "/some/path",
	}

	assert.Nil(t, server.searcher)
	assert.Equal(t, "/some/path", server.docsDir)
}

func TestNewServerNilSearcher(t *testing.T) {
	// Server can be created with nil searcher
	server := NewServer(nil, "/docs")
	assert.NotNil(t, server)
	assert.Nil(t, server.searcher)
}

func TestNewServerEmptyDocsDir(t *testing.T) {
	s := searcher.New(nil, nil)
	server := NewServer(s, "")
	assert.NotNil(t, server)
	assert.Equal(t, "", server.docsDir)
}
