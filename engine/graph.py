class MemoryGraph:
    """
    Lightweight graph layer for linking memories.
    Nodes = memory items
    Edges = semantic or contextual relationships
    """

    def __init__(self):
        self.nodes = {}
        self.edges = {}

    def add_node(self, node_id, data=None):
        self.nodes[node_id] = data or {}
        self.edges.setdefault(node_id, set())

    def add_edge(self, src, dst):
        self.edges.setdefault(src, set()).add(dst)
        self.edges.setdefault(dst, set()).add(src)

    def neighbors(self, node_id):
        return list(self.edges.get(node_id, []))

    def to_dict(self):
        return {
            "nodes": self.nodes,
            "edges": {k: list(v) for k, v in self.edges.items()}
        }
