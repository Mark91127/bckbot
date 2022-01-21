// Generated by https://quicktype.io
//
// To change quicktype's target language, run command:
//
//   "Set quicktype target language"

export interface APIDeviantArt {
    version:               string;
    type:                  string;
    title:                 string;
    category:              string;
    url:                   string;
    author_name:           string;
    author_url:            string;
    provider_name:         string;
    provider_url:          string;
    safety:                string;
    pubdate:               Date;
    community:             Community;
    rating:                string;
    copyright:             Copyright;
    width:                 number;
    height:                number;
    imagetype:             string;
    thumbnail_url:         string;
    thumbnail_width:       number;
    thumbnail_height:      number;
    thumbnail_url_150:     string;
    thumbnail_url_200h:    string;
    thumbnail_width_200h:  number;
    thumbnail_height_200h: number;
}

export interface Community {
    statistics: Statistics;
}

export interface Statistics {
    _attributes: StatisticsAttributes;
}

export interface StatisticsAttributes {
    views:     number;
    favorites: number;
    comments:  number;
    downloads: number;
}

export interface Copyright {
    _attributes: CopyrightAttributes;
}

export interface CopyrightAttributes {
    url:    string;
    year:   string;
    entity: string;
}
