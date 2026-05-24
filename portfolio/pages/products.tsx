import React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Eye, ArrowRight, MapPin, Globe,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import globalProductsData from '../global_products.json';
import transformerProductsData from '../transformer_products.json';
import siteData from "@/data/siteData.json";

// react-simple-maps is browser-only (fetches topojson at render time), so we
// keep it out of the static export by deferring it to client mount.
const MapSkeleton = () => (
  <div className="aspect-[16/9] w-full animate-pulse rounded-xl bg-slate-100" />
);
const IndiaMap = dynamic(() => import('@/components/ReachMaps').then((m) => m.IndiaMap), {
  ssr: false, loading: () => <MapSkeleton />,
});
const WorldMap = dynamic(() => import('@/components/ReachMaps').then((m) => m.WorldMap), {
  ssr: false, loading: () => <MapSkeleton />,
});

const ProductsPage = () => {
  // Combine all products from both data sources (transformer file is currently empty).
  const allProductsData = [...globalProductsData.products, ...transformerProductsData.products];

  // Transform the JSON data to match the card structure.
  const products = allProductsData.map((product, index) => ({
    id: index + 1,
    slug: product.slug,
    src: product.image || `/lovable-uploads/5663820f-6c97-4492-9210-9eaa1a8dc415.png`,
    title: product.title,
    category: product.subtitle,
    description: product.description.length > 120
      ? product.description.substring(0, 120) + '...'
      : product.description,
  }));

  // (Removed the IntersectionObserver glue that drove the entrance
  // animations — its CSS keyframes lived only in the homepage component,
  // so on this page the cards stayed at opacity-0 forever.)

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar navData={siteData.navigation} siteInfo={siteData.site} />
      
      {/* Hero Section */}
      <section className="pt-20 pb-12 bg-gradient-to-br from-gray-900 via-gray-800 to-pulse-900">
        <div className="section-container">
          <div className="text-center text-white">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold mb-4">
              Engineering <span className="text-pulse-400">Excellence</span>
            </h1>
            <p className="text-xl text-gray-300 max-w-3xl mx-auto">
              Our complete range of CRGO cores, laminations and nanocrystalline cores — engineered for efficiency, built for precision. Trusted by transformer manufacturers across India and beyond.
            </p>
          </div>
        </div>
      </section>
      
      {/* Products Grid Section */}
      <section className="py-16">
        <div className="section-container">
          {/* Section Header */}
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-gray-900 mb-4">
              Complete Product Range
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Twelve product families covering toroidal cores, cut cores, gap cores, laminations, strip, slit coils, E cores, step cores and nanocrystalline toroids — everything a transformer maker needs.
            </p>
          </div>

          {/* Products Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {products.map((product) => {
              return (
                <div
                  key={product.id}
                  className="product-card group relative overflow-hidden bg-white rounded-2xl shadow-elegant hover:shadow-elegant-hover transition-all duration-500 transform hover:-translate-y-2"
                >
                  {/* Image Container */}
                  <div className="relative overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200 h-64">
                    <div 
                      className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-110"
                      style={{
                        backgroundImage: `url('${product.src}')`,
                      }}
                    />
                    
                    {/* Hover Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    
                    {/* View Product Button */}
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-4 group-hover:translate-y-0">
                      <Link 
                        href={`/products/${product.slug}`}
                        className="flex items-center space-x-2 bg-white text-pulse-600 px-6 py-3 rounded-full font-medium hover:bg-pulse-50 transition-colors duration-200"
                      >
                        <Eye className="w-4 h-4" />
                        <span>View Details</span>
                      </Link>
                    </div>
                  </div>
                  
                  {/* Content */}
                  <div className="p-6">
                    <div className="mb-3">
                      <h3 className="text-xl font-display font-bold text-gray-900 group-hover:text-pulse-600 transition-colors duration-200">
                        {product.title}
                      </h3>
                    </div>
                    <p className="text-gray-600 text-sm leading-relaxed mb-6">
                      {product.description}
                    </p>
                    
                    {/* CTA Button */}
                    <Link 
                      href={`/products/${product.slug}`}
                      className="w-full flex items-center justify-center space-x-2 bg-gray-100 hover:bg-pulse-500 text-gray-700 hover:text-white py-3 px-4 rounded-full font-medium transition-all duration-300 group-hover:transform group-hover:scale-[1.02]"
                    >
                      <span>Learn More</span>
                      <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
          
        </div>
      </section>

      {/* ── Where We Reach ───────────────────────────────────────── */}
      <section className="py-16 bg-white border-t border-gray-100">
        <div className="section-container">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-gray-900 mb-3">
              Where We Reach
            </h2>
            <p className="text-lg text-gray-600 max-w-3xl mx-auto">
              From our manufacturing facility in Vadodara, Gujarat, our CRGO cores
              and laminations serve transformer manufacturers across India and
              international markets.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6 mb-12">
            {/* Pan India — illustrated map */}
            <div className="bg-gray-50 rounded-2xl p-6 md:p-8 border border-gray-100 hover:shadow-elegant transition-shadow">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-11 h-11 rounded-xl bg-pulse-100 flex items-center justify-center text-pulse-600">
                  <MapPin className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-xl font-display font-bold text-gray-900">Pan-India Presence</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Active customers in every major industrial belt — north to south, east to west.
                  </p>
                </div>
              </div>
              <div className="rounded-xl overflow-hidden bg-white border border-gray-100 p-2">
                <IndiaMap />
              </div>
              <div className="mt-3 text-[11px] text-gray-500 leading-relaxed">
                <span className="font-semibold text-gray-700">17+ cities</span> —
                hover any marker to see the city / region.
              </div>
            </div>

            {/* Global — illustrated map */}
            <div className="bg-gray-50 rounded-2xl p-6 md:p-8 border border-gray-100 hover:shadow-elegant transition-shadow">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-11 h-11 rounded-xl bg-pulse-100 flex items-center justify-center text-pulse-600">
                  <Globe className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-xl font-display font-bold text-gray-900">Global Reach</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Exporting from Vadodara to transformer makers worldwide.
                  </p>
                </div>
              </div>
              <div className="rounded-xl overflow-hidden bg-white border border-gray-100 p-2">
                <WorldMap />
              </div>
              <div className="mt-3 text-[11px] text-gray-500 leading-relaxed">
                <span className="font-semibold text-gray-700">India highlighted</span> —
                each green dot is an active export market. Hover for the city.
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* CTA Section */}
      <section className="pt-4 pb-12 bg-gray-50">
        <div className="section-container">
          <div className="text-center">
            <p className="text-gray-600 mb-4 text-lg">Need custom specifications or a bulk enquiry?</p>
            <Link href="/contact" className="button-primary inline-flex items-center space-x-2">
              <span>Contact Our Engineering Team</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      <Footer />

    </div>
  );
};

export default ProductsPage;
