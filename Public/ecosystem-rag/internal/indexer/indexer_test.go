package indexer

import (
	"testing"
	"time"

	"github.com/meucontrole-ai/ecosystem-rag/internal/bm25"
	"github.com/stretchr/testify/assert"
)

func TestNewIndexer(t *testing.T) {
	corpus := bm25.NewCorpus()
	idx := New(corpus, nil, "/docs")

	assert.NotNil(t, idx)
	assert.Equal(t, corpus, idx.corpus)
	assert.Nil(t, idx.qclient)
	assert.Equal(t, "/docs", idx.docsDir)
}

func TestStatsStructure(t *testing.T) {
	stats := Stats{
		FilesProcessed: 10,
		ChunksIndexed:  100,
		ChunksSkipped: 5,
		Duration:      5 * time.Second,
	}

	assert.Equal(t, 10, stats.FilesProcessed)
	assert.Equal(t, 100, stats.ChunksIndexed)
	assert.Equal(t, 5, stats.ChunksSkipped)
	assert.Equal(t, 5*time.Second, stats.Duration)
}

func TestStatsZero(t *testing.T) {
	stats := Stats{}

	assert.Equal(t, 0, stats.FilesProcessed)
	assert.Equal(t, 0, stats.ChunksIndexed)
	assert.Equal(t, 0, stats.ChunksSkipped)
	assert.Equal(t, time.Duration(0), stats.Duration)
}

func TestIndexerStructure(t *testing.T) {
	corpus := bm25.NewCorpus()

	idx := New(corpus, nil, "/some/path")

	assert.Equal(t, corpus, idx.corpus)
	assert.Nil(t, idx.qclient)
	assert.Equal(t, "/some/path", idx.docsDir)
}

func TestIndexerWithNilDependencies(t *testing.T) {
	// Indexer can be created with nil dependencies
	// (though IndexAll would fail when using them)
	idx := New(nil, nil, "/docs")
	assert.NotNil(t, idx)
}

func TestStatsDuration(t *testing.T) {
	start := time.Now()
	stats := Stats{
		Duration: time.Since(start),
	}
	assert.GreaterOrEqual(t, stats.Duration, time.Duration(0))
}

func TestIndexerWithRealCorpus(t *testing.T) {
	corpus := bm25.NewCorpus()
	corpus.AddDocument("test document content")

	idx := New(corpus, nil, "/docs")

	assert.NotNil(t, idx.corpus)
	assert.Equal(t, corpus, idx.corpus)
}
