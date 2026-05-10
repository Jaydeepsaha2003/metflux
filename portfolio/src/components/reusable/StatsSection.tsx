import React from "react";
import Section from "./Section";
import SectionHeader from "./SectionHeader";
import StatCard from "./StatCard";

interface StatItem {
  value: string;
  label: string;
  description?: string;
}

interface StatsData {
  badge?: {
    icon?: string;
    text: string;
  };
  title?: string;
  subtitle?: string;
  description?: string;
  stats: StatItem[];
}

interface StatsSectionProps {
  data: StatsData;
  backgroundClass?: string;
  className?: string;
  id?: string;
  columns?: number;
}

const StatsSection: React.FC<StatsSectionProps> = ({
  data,
  backgroundClass = "bg-white",
  className = "",
  id,
  columns = 4
}) => {
  const getGridClass = () => {
    switch (columns) {
      case 2: return "grid-cols-1 sm:grid-cols-2";
      case 3: return "grid-cols-1 sm:grid-cols-3";
      case 4: return "grid-cols-2 md:grid-cols-4";
      default: return "grid-cols-2 md:grid-cols-4";
    }
  };

  return (
    <Section
      id={id}
      backgroundClass={backgroundClass}
      className={className}
    >
      {(data.title || data.badge || data.description) && (
        <SectionHeader
          badge={data.badge}
          title={data.title || ""}
          subtitle={data.subtitle}
          description={data.description}
        />
      )}
      
      <div className={`grid ${getGridClass()} gap-8 opacity-0 fade-in-element`}>
        {data.stats.map((stat, index) => (
          <StatCard
            key={index}
            value={stat.value}
            label={stat.label}
            description={stat.description}
          />
        ))}
      </div>
    </Section>
  );
};

export default StatsSection;
