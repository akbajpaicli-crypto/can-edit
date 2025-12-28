import streamlit as st
import pandas as pd
import numpy as np
from datetime import datetime
import folium
from streamlit_folium import folium_static
from math import radians, cos, sin, asin, sqrt

# Page configuration
st.set_page_config(
    page_title="OHE स्ट्रक्चर स्पीड एनालाइज़र",
    page_icon="🚂",
    layout="wide"
)

st.title("🚂 OHE स्ट्रक्चर स्पीड एनालाइज़र")

# Haversine distance calculation
def haversine_distance(lat1, lon1, lat2, lon2):
    """
    Calculate the great circle distance between two points 
    on the earth (specified in decimal degrees)
    Returns distance in meters
    """
    # Convert decimal degrees to radians
    lon1, lat1, lon2, lat2 = map(radians, [lon1, lat1, lon2, lat2])
    
    # Haversine formula
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
    c = 2 * asin(sqrt(a))
    
    # Radius of earth in meters
    r = 6371000
    return c * r

@st.cache_data
def load_and_validate_train_data(file):
    """Load and validate train data file"""
    try:
        if file.name.endswith('.csv'):
            df = pd.read_csv(file)
        else:
            df = pd.read_excel(file)
        
        # Check required columns (flexible column name matching)
        required_cols = ['device_id', 'logging_time', 'latitude', 'longitude', 'speed']
        df.columns = df.columns.str.lower().str.strip()
        
        missing_cols = [col for col in required_cols if col not in df.columns]
        if missing_cols:
            st.error(f"❌ त्रुटि: गायब कॉलम: {', '.join(missing_cols)}")
            return None
        
        # Convert data types
        df['latitude'] = pd.to_numeric(df['latitude'], errors='coerce')
        df['longitude'] = pd.to_numeric(df['longitude'], errors='coerce')
        df['speed'] = pd.to_numeric(df['speed'], errors='coerce')
        
        # Remove rows with invalid coordinates
        df = df.dropna(subset=['latitude', 'longitude', 'speed'])
        
        return df
    except Exception as e:
        st.error(f"❌ त्रुटि: फ़ाइल पढ़ने में समस्या - {str(e)}")
        return None

@st.cache_data
def load_and_validate_ohe_data(file):
    """Load and validate OHE structure data file"""
    try:
        if file.name.endswith('.csv'):
            df = pd.read_csv(file)
        else:
            df = pd.read_excel(file)
        
        # Check required columns
        required_cols = ['structure_id', 'latitude', 'longitude']
        df.columns = df.columns.str.lower().str.strip()
        
        missing_cols = [col for col in required_cols if col not in df.columns]
        if missing_cols:
            st.error(f"❌ त्रुटि: गायब कॉलम: {', '.join(missing_cols)}")
            return None
        
        # Convert data types
        df['latitude'] = pd.to_numeric(df['latitude'], errors='coerce')
        df['longitude'] = pd.to_numeric(df['longitude'], errors='coerce')
        
        # Remove rows with invalid coordinates
        df = df.dropna(subset=['latitude', 'longitude'])
        
        return df
    except Exception as e:
        st.error(f"❌ त्रुटि: फ़ाइल पढ़ने में समस्या - {str(e)}")
        return None

@st.cache_data
def match_train_to_ohe(train_df, ohe_df, threshold_meters):
    """Match train GPS points to OHE structures"""
    results = []
    
    for idx, ohe_row in ohe_df.iterrows():
        ohe_lat = ohe_row['latitude']
        ohe_lon = ohe_row['longitude']
        structure_id = ohe_row['structure_id']
        
        # Calculate distances to all train points
        distances = train_df.apply(
            lambda row: haversine_distance(ohe_lat, ohe_lon, row['latitude'], row['longitude']),
            axis=1
        )
        
        # Find closest match
        min_distance_idx = distances.idxmin()
        min_distance = distances.min()
        
        if min_distance <= threshold_meters:
            matched_row = train_df.loc[min_distance_idx]
            results.append({
                'Structure ID': structure_id,
                'Matched Speed (kmph)': round(matched_row['speed'], 2),
                'Closest Distance (m)': round(min_distance, 2),
                'Matched Train Time': matched_row['logging_time'],
                'OHE Latitude': ohe_lat,
                'OHE Longitude': ohe_lon,
                'Train Latitude': matched_row['latitude'],
                'Train Longitude': matched_row['longitude']
            })
    
    return pd.DataFrame(results)

# Sidebar - Data Upload and Configuration
with st.sidebar:
    st.header("📁 डेटा अपलोड")
    
    # Train data upload
    train_file = st.file_uploader(
        "RTIS ट्रेन डेटा अपलोड करें",
        type=['csv', 'xlsx', 'xls'],
        help="डिवाइस ID, लॉगिंग टाइम, अक्षांश, देशांतर और गति वाला CSV/Excel फ़ाइल।"
    )
    
    # OHE structure upload
    ohe_file = st.file_uploader(
        "OHE संरचना स्थान अपलोड करें",
        type=['csv', 'xlsx', 'xls'],
        help="संरचना ID, अक्षांश और देशांतर वाला CSV/Excel फ़ाइल।"
    )
    
    st.divider()
    
    st.header("⚙️ कॉन्फ़िगरेशन")
    
    # Matching threshold
    threshold = st.slider(
        "अधिकतम मैचिंग दूरी (मीटर में)",
        min_value=10,
        max_value=200,
        value=50,
        step=5,
        help="ट्रेन के GPS पॉइंट को OHE स्ट्रक्चर के GPS पॉइंट से मिलाने के लिए अधिकतम दूरी निर्धारित करें।"
    )
    
    st.divider()
    
    # Analyze button
    analyze_button = st.button(
        "✨ विश्लेषण शुरू करें",
        disabled=(train_file is None or ohe_file is None),
        type="primary",
        use_container_width=True
    )

# Main area
if analyze_button:
    with st.spinner('डेटा लोड हो रहा है...'):
        # Load data
        train_df = load_and_validate_train_data(train_file)
        ohe_df = load_and_validate_ohe_data(ohe_file)
        
        if train_df is not None and ohe_df is not None:
            # Success message
            st.success(f"✅ {len(train_df)} ट्रेन रिकॉर्ड और {len(ohe_df)} OHE स्ट्रक्चर सफलतापूर्वक लोड किए गए।")
            
            # Perform matching
            with st.spinner('विश्लेषण चल रहा है...'):
                results_df = match_train_to_ohe(train_df, ohe_df, threshold)
            
            # Display metrics
            st.header("📊 सारांश")
            col1, col2, col3 = st.columns(3)
            
            with col1:
                st.metric("कुल OHE स्ट्रक्चर", len(ohe_df))
            
            with col2:
                st.metric("मैच किए गए स्ट्रक्चर", len(results_df))
            
            with col3:
                success_rate = (len(results_df) / len(ohe_df) * 100) if len(ohe_df) > 0 else 0
                st.metric("मैच सफलता दर", f"{success_rate:.1f}%")
            
            st.divider()
            
            # Interactive Map
            st.header("🗺️ मैच किए गए स्थान")
            
            if len(results_df) > 0:
                # Calculate map center
                center_lat = results_df['OHE Latitude'].mean()
                center_lon = results_df['OHE Longitude'].mean()
                
                # Create map
                m = folium.Map(
                    location=[center_lat, center_lon],
                    zoom_start=12,
                    tiles='OpenStreetMap'
                )
                
                # Add OHE structures (red markers)
                for idx, row in ohe_df.iterrows():
                    folium.CircleMarker(
                        location=[row['latitude'], row['longitude']],
                        radius=5,
                        color='red',
                        fill=True,
                        fillColor='red',
                        fillOpacity=0.7,
                        popup=f"OHE ID: {row['structure_id']}"
                    ).add_to(m)
                
                # Add train route (light blue line)
                train_coords = train_df[['latitude', 'longitude']].values.tolist()
                folium.PolyLine(
                    train_coords,
                    color='lightblue',
                    weight=2,
                    opacity=0.6
                ).add_to(m)
                
                # Add matched points (green markers)
                for idx, row in results_df.iterrows():
                    folium.Marker(
                        location=[row['Train Latitude'], row['Train Longitude']],
                        icon=folium.Icon(color='green', icon='info-sign'),
                        popup=f"""
                        <b>OHE ID:</b> {row['Structure ID']}<br>
                        <b>गति:</b> {row['Matched Speed (kmph)']} kmph<br>
                        <b>दूरी:</b> {row['Closest Distance (m)']} m<br>
                        <b>समय:</b> {row['Matched Train Time']}
                        """
                    ).add_to(m)
                
                folium_static(m, width=1200, height=500)
            else:
                st.warning("⚠️ कोई मैच नहीं मिला। कृपया थ्रेशोल्ड बढ़ाएं।")
            
            st.divider()
            
            # Detailed results table
            st.header("📋 विस्तृत OHE स्पीड डेटा")
            
            if len(results_df) > 0:
                # Distance filter
                col1, col2 = st.columns([1, 3])
                with col1:
                    max_distance_filter = st.number_input(
                        "अधिकतम दूरी फ़िल्टर (मीटर)",
                        min_value=0,
                        max_value=int(results_df['Closest Distance (m)'].max()),
                        value=int(results_df['Closest Distance (m)'].max()),
                        step=5
                    )
                
                # Apply filter
                filtered_df = results_df[results_df['Closest Distance (m)'] <= max_distance_filter]
                
                # Display table
                display_df = filtered_df[['Structure ID', 'Matched Speed (kmph)', 'Closest Distance (m)', 'Matched Train Time']]
                
                st.dataframe(
                    display_df,
                    use_container_width=True,
                    height=400
                )
                
                # Download button
                csv = filtered_df.to_csv(index=False).encode('utf-8')
                st.download_button(
                    label="📥 परिणाम डाउनलोड करें (CSV)",
                    data=csv,
                    file_name=f"ohe_speed_analysis_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv",
                    mime="text/csv"
                )
                
                st.info(f"📊 {len(filtered_df)} परिणाम प्रदर्शित किए गए (कुल {len(results_df)} में से)")
            else:
                st.warning("⚠️ कोई मैच नहीं मिला।")

else:
    # Welcome message
    st.info("👈 कृपया साइडबार से ट्रेन डेटा और OHE स्ट्रक्चर फ़ाइल अपलोड करें।")
    
    st.markdown("""
    ### 📖 उपयोग निर्देश
    
    1. **ट्रेन डेटा फ़ाइल** अपलोड करें जिसमें निम्नलिखित कॉलम हों:
       - `device_id` - डिवाइस की पहचान
       - `logging_time` - समय स्टैम्प
       - `latitude` - अक्षांश
       - `longitude` - देशांतर
       - `speed` - गति (kmph में)
    
    2. **OHE संरचना फ़ाइल** अपलोड करें जिसमें निम्नलिखित कॉलम हों:
       - `structure_id` - संरचना की पहचान
       - `latitude` - अक्षांश
       - `longitude` - देशांतर
    
    3. **मैचिंग दूरी** सेट करें (डिफ़ॉल्ट: 50 मीटर)
    
    4. **विश्लेषण शुरू करें** बटन पर क्लिक करें
    
    5. परिणाम देखें और डाउनलोड करें
    """)
