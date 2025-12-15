default_config = {
    "embedding_model": "local-embedder",
    "vector_store": "inmemory",
    "graph_enabled": True,
    "snapshot_path": "./storage/snapshots",
}

class Config:
    def __init__(self, overrides=None):
        self.values = default_config.copy()
        if overrides:
            self.values.update(overrides)

    def get(self, key, default=None):
        return self.values.get(key, default)
