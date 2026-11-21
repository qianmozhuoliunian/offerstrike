# Third-party code

The NowCoder source adapters in `src/research/read-source.js` and `backend/research/source.py` adapt the source/body separation, creation-time conversion and empty-content handling of InterviewRadar's `scripts/connectors/nowcoder.py`.

Upstream commit is `f551c9c24e274c4a361e870f5e269ddb7cef6ca6`.

https://github.com/KunChen1110/InterviewRadar/blob/f551c9c24e274c4a361e870f5e269ddb7cef6ca6/scripts/connectors/nowcoder.py

The adapter uses a public content-detail response for the selected article ID because the current discussion HTML can return an empty shell. Article content is owned by its respective authors.

MIT License

Copyright (c) 2026 Kun Chen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
