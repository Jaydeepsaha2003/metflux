import './commercial-workspace.css';

export function InsightMetrics({ title, scope, items }: {
  title: string; scope: string;
  items: { label: string; value: string; note?: string; onClick?: () => void }[];
}) {
  return <section className="commercial-insights" aria-label={title}>
    <header><h2>{title}</h2><span>{scope}</span></header>
    <div className="commercial-metrics">{items.map(item => <div key={item.label}>
      <span>{item.label}</span><strong>{item.value}</strong>
      {item.note && <small>{item.note}</small>}
      {item.onClick && <button type="button" aria-label={`View ${item.label.toLowerCase()} records`} onClick={item.onClick}>View records →</button>}
    </div>)}</div>
  </section>;
}

export function InsightBreakdown({ title, scope, items, unit }: {
  title: string; scope: string; items: { label: string; value: number }[]; unit: string;
}) {
  const sorted = [...items].sort((a,b) => b.value-a.value);
  const max = Math.max(1, ...sorted.map(i=>i.value));
  return <section className="commercial-insights commercial-breakdown">
    <header><h2>{title}</h2><span>{scope}</span></header>
    {!sorted.length ? <p>No records to analyse.</p> : sorted.slice(0,5).map(item => <div className="commercial-bar" key={item.label}>
      <div><span>{item.label}</span><strong>{item.value.toLocaleString('en-IN')} {unit}</strong></div>
      <div className="commercial-track"><span style={{width:`${Math.max(0,item.value)/max*100}%`}} /></div>
    </div>)}
  </section>;
}
