package watcher

import (
	"testing"
	"time"

	"github.com/meucontrole-ai/ecosystem-rag/internal/indexer"
	"github.com/stretchr/testify/assert"
)

func TestNewWatcher(t *testing.T) {
	idx := &indexer.Indexer{}
	w := New(idx, "/docs")

	assert.NotNil(t, w)
	assert.Equal(t, idx, w.indexer)
	assert.Equal(t, "/docs", w.docsDir)
	assert.Equal(t, 2*time.Second, w.debounce)
}

func TestWatcherStructure(t *testing.T) {
	idx := &indexer.Indexer{}
	w := &Watcher{
		indexer:  idx,
		docsDir: "/some/path",
		debounce: 5 * time.Second,
	}

	assert.Equal(t, idx, w.indexer)
	assert.Equal(t, "/some/path", w.docsDir)
	assert.Equal(t, 5*time.Second, w.debounce)
}

func TestWatcherDebounceDuration(t *testing.T) {
	idx := &indexer.Indexer{}

	// Default debounce
	w1 := New(idx, "/docs")
	assert.Equal(t, 2*time.Second, w1.debounce)

	// Custom debounce would require changing the struct field
	// since New() doesn't accept a debounce parameter
	w2 := &Watcher{
		indexer:  idx,
		docsDir: "/docs",
		debounce: 5 * time.Second,
	}
	assert.Equal(t, 5*time.Second, w2.debounce)
}

func TestWatcherNilIndexer(t *testing.T) {
	// Watcher can be created with nil indexer
	w := New(nil, "/docs")
	assert.NotNil(t, w)
	assert.Nil(t, w.indexer)
}
