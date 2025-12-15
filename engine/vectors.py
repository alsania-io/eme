class VectorStore:
    """
    Abstract interface for vector storage.
    Can be backed by Qdrant, Chroma, FAISS, or in-memory.
    """

    def __init__(self):
        self.store = {}

    def add(self, vector_id, vector, metadata=None):
        self.store[vector_id] = {
            "vector": vector,
            "metadata": metadata or {}
        }

    def search(self, query_vector, limit=5):
        # TODO: implement cosine similarity search
        return []

    def to_dict(self):
        return self.store
