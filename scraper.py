import json

from myinstants_api import search

if __name__ == "__main__":
    print(json.dumps(search(input("Search for: "))))