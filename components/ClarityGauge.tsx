import React from 'react';

interface ClarityGaugeProps {
  score: number;
}

const ClarityGauge: React.FC<ClarityGaugeProps> = ({ score }) => {
  // Determine color based on score
  const getColor = (val: number) => {
    if (val >= 80) return 'bg-emerald-500';
    if (val >= 50) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const colorClass = getColor(score);

  return (
    <div className="w-full bg-slate-800 rounded-xl p-4 shadow-lg border border-slate-700">
      <div className="flex justify-between items-end mb-2">
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Live Clarity Score</h3>
        <span className={`text-2xl font-bold ${score >= 80 ? 'text-emerald-400' : score >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
          {score}%
        </span>
      </div>
      <div className="h-4 w-full bg-slate-900 rounded-full overflow-hidden relative">
        <div
          className={`h-full transition-all duration-700 ease-out ${colorClass}`}
          style={{ width: `${score}%` }}
        />
        {/* Grid lines for visual aid */}
        <div className="absolute inset-0 grid grid-cols-4 pointer-events-none">
          <div className="border-r border-slate-800/50"></div>
          <div className="border-r border-slate-800/50"></div>
          <div className="border-r border-slate-800/50"></div>
        </div>
      </div>
      <p className="text-xs text-slate-500 mt-2 text-right">Target: Keep it simple & clear.</p>
    </div>
  );
};

export default ClarityGauge;