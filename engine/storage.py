import os
import json

class StorageLayer:
    """
    Handles snapshot export, import, and local persistence.
    """

    def __init__(self, base_path="./storage/snapshots"):
        self.base_path = base_path
        os.makedirs(self.base_path, exist_ok=True)

    def save_snapshot(self, name, data):
        path = os.path.join(self.base_path, f"{name}.json")
        with open(path, "w") as f:
            json.dump(data, f, indent=2)
        return path

    def load_snapshot(self, name):
        path = os.path.join(self.base_path, f"{name}.json")
        if not os.path.exists(path):
            return None
        with open(path, "r") as f:
            return json.load(f)

    def list_snapshots(self):
        return [f for f in os.listdir(self.base_path) if f.endswith(".json")]
