function Pagination({ page, hasNext, onPage }: { page: number; hasNext: boolean; onPage(page: number): void }) {
  return <nav className="pagination" aria-label="페이지 탐색">
    <button className="quiet" disabled={page === 0} onClick={() => onPage(page - 1)}>이전</button>
    <span>{page + 1} 페이지</span>
    <button className="quiet" disabled={!hasNext} onClick={() => onPage(page + 1)}>다음</button>
  </nav>;
}

export default Pagination;