function date(value: string | null) {
  return value ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value)) : "—";
}

export default date;